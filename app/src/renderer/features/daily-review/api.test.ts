// Daily Review's completed work is cached per workspace (VERM-114 review):
// opening A and then B inside the cache window, with A's answer arriving
// late, must leave each workspace's view showing only its own tickets and
// warnings. Exercised against a real QueryClient, the same cache the hook uses.
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { DailyReviewGetArgs, DailyReviewGetResult } from '../../../shared/ipc';
import {
  DAILY_REVIEW_COMPLETED_QUERY_KEY,
  DAILY_REVIEW_WRONG_WORKSPACE_MESSAGE,
  dailyReviewCompletedQuery,
  dailyReviewCompletedQueryKey,
} from './api';

// Fictional values only.
const ANSWERS: Record<string, DailyReviewGetResult> = {
  'ws-a': { ok: true, workspaceId: 'ws-a', completed: [{ idReadable: 'HOME-1', summary: 'Finished the home task', priority: null }], warnings: [] },
  'ws-b': {
    ok: true,
    workspaceId: 'ws-b',
    completed: [{ idReadable: 'WORK-7', summary: 'Closed the work contract', priority: 'Major' }],
    warnings: ['INBX: no Status value is mapped to done, so done issues from INBX are not shown.'],
  },
};

/** A fake dailyReviewGet whose answer for each workspace is released by hand. */
function heldBackend() {
  const pending = new Map<string, () => void>();
  const calls: string[] = [];
  const get = (args: DailyReviewGetArgs) =>
    new Promise<DailyReviewGetResult>((resolve) => {
      calls.push(args.workspaceId);
      pending.set(args.workspaceId, () => resolve(ANSWERS[args.workspaceId]));
    });
  return { get, calls, release: (id: string) => pending.get(id)?.() };
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('Daily Review completed work, per workspace', () => {
  it('every workspace has its own cache entry under the shared prefix', () => {
    expect(dailyReviewCompletedQueryKey('ws-a')).toEqual([...DAILY_REVIEW_COMPLETED_QUERY_KEY, 'ws-a']);
    expect(dailyReviewCompletedQueryKey('ws-a')).not.toEqual(dailyReviewCompletedQueryKey('ws-b'));
  });

  it('opening A then B within the cache window, with A answering late, keeps each view to its own tickets and warnings', async () => {
    const qc = client();
    const backend = heldBackend();

    // Open A: its request goes out and is held.
    const a = qc.fetchQuery(dailyReviewCompletedQuery('ws-a', backend.get));
    // Switch to B before A answers: B's request goes out and answers first.
    const b = qc.fetchQuery(dailyReviewCompletedQuery('ws-b', backend.get));
    expect(backend.calls).toEqual(['ws-a', 'ws-b']);
    backend.release('ws-b');
    await b;

    const viewB = () => qc.getQueryData<DailyReviewGetResult>(dailyReviewCompletedQueryKey('ws-b'));
    expect(viewB()?.completed?.map((t) => t.summary)).toEqual(['Closed the work contract']);
    expect(viewB()?.warnings).toEqual(ANSWERS['ws-b'].warnings);

    // A's late answer arrives: it fills A's entry only, and B is unchanged.
    backend.release('ws-a');
    await a;
    expect(viewB()?.completed?.map((t) => t.summary)).toEqual(['Closed the work contract']);
    expect(viewB()?.warnings).toEqual(ANSWERS['ws-b'].warnings);
    const viewA = qc.getQueryData<DailyReviewGetResult>(dailyReviewCompletedQueryKey('ws-a'));
    expect(viewA?.completed?.map((t) => t.summary)).toEqual(['Finished the home task']);
    expect(viewA?.warnings).toEqual([]);

    // Back to A inside the cache window: served from A's own entry, no new request.
    const again = await qc.fetchQuery(dailyReviewCompletedQuery('ws-a', backend.get));
    expect(again.completed?.map((t) => t.idReadable)).toEqual(['HOME-1']);
    expect(backend.calls).toEqual(['ws-a', 'ws-b']);
  });

  it('refuses an answer that names a different workspace, so it never fills the asking view', async () => {
    const qc = client();
    const misrouted = async () => ANSWERS['ws-a'];
    await expect(qc.fetchQuery(dailyReviewCompletedQuery('ws-b', misrouted))).rejects.toThrow(DAILY_REVIEW_WRONG_WORKSPACE_MESSAGE);
    expect(qc.getQueryData(dailyReviewCompletedQueryKey('ws-b'))).toBeUndefined();
  });

  it('a refusal for a workspace that was not active is an error, never cached as that workspace\'s answer', async () => {
    const qc = client();
    const refused = async (): Promise<DailyReviewGetResult> => ({ ok: false, workspaceId: 'ws-a', refused: 'not-active', error: 'That workspace is no longer active, so its Daily Review was not loaded.' });
    await expect(qc.fetchQuery(dailyReviewCompletedQuery('ws-a', refused))).rejects.toThrow(/no longer active/);
    expect(qc.getQueryData(dailyReviewCompletedQueryKey('ws-a'))).toBeUndefined();
    // Next time A is opened while active, it is read afresh.
    const backend = heldBackend();
    const again = qc.fetchQuery(dailyReviewCompletedQuery('ws-a', backend.get));
    backend.release('ws-a');
    expect((await again).completed?.map((t) => t.idReadable)).toEqual(['HOME-1']);
    expect(backend.calls).toEqual(['ws-a']);
  });

  it('asks the main process for exactly the workspace the view is for', async () => {
    const asked: DailyReviewGetArgs[] = [];
    await client().fetchQuery(dailyReviewCompletedQuery('ws-b', async (args) => { asked.push(args); return ANSWERS['ws-b']; }));
    expect(asked).toEqual([{ workspaceId: 'ws-b' }]);
  });
});

// The board's sync against a real React Query cache, with window.vermilian
// stubbed to the two read calls it may make (VERM-39). Node environment: no
// DOM, no Electron.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { BoardIssue, IssueDetail } from '../../../shared/workspace';
import type { GetWorkspaceJiraIssuesResult, GetWorkspaceJiraRecentlyUpdatedResult } from '../../../shared/ipc';
import { FIELD_KEYS, type BoardIssueFields } from '../../../shared/fields';
import { JIRA_POLL_GAP_LIMIT_MS, JIRA_POLL_INTERVAL_MS } from '../../../shared/jiraPoll';
import {
  applyJiraUpdates,
  boardIssueOf,
  fetchFullJiraIssues,
  pollJiraProject,
  resetJiraSyncStateForTests,
  workspaceJiraIssuesQueryKey,
} from './jiraBoardSync';

const T0 = Date.parse('2026-11-14T12:00:00.000Z');

function issue(id: string, key: string, over: Partial<BoardIssue> = {}): BoardIssue {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as unknown as BoardIssueFields;
  fields.status = 'To Do';
  return { id, idReadable: key, summary: key, resolved: null, fields, parentEpic: null, isEpic: false, statusRole: 'todo', updated: T0, ...over };
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const api = {
  getWorkspaceJiraIssues: vi.fn<(a: { workspaceId: string; projectKey: string; includeResolved?: boolean }) => Promise<GetWorkspaceJiraIssuesResult>>(),
  getWorkspaceJiraRecentlyUpdated: vi.fn<(a: { workspaceId: string; projectKey: string }) => Promise<GetWorkspaceJiraRecentlyUpdatedResult>>(),
};

let qc: QueryClient;
const KEY_A = workspaceJiraIssuesQueryKey('ws-a', 'DEMO', false);
const KEY_A_OPS = workspaceJiraIssuesQueryKey('ws-a', 'OPS', false);
const KEY_B = workspaceJiraIssuesQueryKey('ws-b', 'DEMO', false);
const list = (key: readonly unknown[]) => {
  const d = qc.getQueryData<GetWorkspaceJiraIssuesResult>(key);
  return d?.ok ? d.issues.map((i) => i.idReadable) : null;
};

async function load(ws: string, project: string, issues: BoardIssue[]) {
  api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues, priorities: [] });
  await qc.fetchQuery({
    queryKey: workspaceJiraIssuesQueryKey(ws, project, false),
    queryFn: ({ signal }) => fetchFullJiraIssues(qc, ws, project, false, signal),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  (globalThis as unknown as { window: unknown }).window = { vermilian: api };
  api.getWorkspaceJiraIssues.mockReset();
  api.getWorkspaceJiraRecentlyUpdated.mockReset();
  resetJiraSyncStateForTests();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  qc.clear();
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('pollJiraProject', () => {
  it('merges an edited and a newly created issue without reloading the list', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    vi.setSystemTime(T0 + JIRA_POLL_INTERVAL_MS);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({
      ok: true,
      issues: [issue('1', 'DEMO-1', { summary: 'Edited', updated: T0 + 30_000 }), issue('2', 'DEMO-2', { updated: T0 + 40_000 })],
    });
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('merged');
    expect(list(KEY_A)).toEqual(['DEMO-2', 'DEMO-1']);
    expect(api.getWorkspaceJiraIssues).toHaveBeenCalledTimes(1);
    expect(api.getWorkspaceJiraRecentlyUpdated).toHaveBeenCalledWith({ workspaceId: 'ws-a', projectKey: 'DEMO' });
  });

  it('drops an issue that was resolved, with Show done off', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1'), issue('2', 'DEMO-2')]);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({
      ok: true,
      issues: [issue('1', 'DEMO-1', { resolved: T0 + 1, statusRole: 'done', updated: T0 + 1 })],
    });
    await pollJiraProject(qc, 'ws-a', 'DEMO', false);
    expect(list(KEY_A)).toEqual(['DEMO-2']);
  });

  it("moves an issue between two of the workspace's project lists", async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    await load('ws-a', 'OPS', []);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'OPS-5', { updated: T0 + 1 })] });
    await pollJiraProject(qc, 'ws-a', 'OPS', false);
    expect(list(KEY_A)).toEqual([]);
    expect(list(KEY_A_OPS)).toEqual(['OPS-5']);
  });

  it("never touches another workspace's lists", async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    await load('ws-b', 'DEMO', [issue('1', 'DEMO-1')]);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [issue('9', 'DEMO-9', { updated: T0 + 1 })] });
    await pollJiraProject(qc, 'ws-a', 'DEMO', false);
    expect(list(KEY_A)).toEqual(['DEMO-9', 'DEMO-1']);
    expect(list(KEY_B)).toEqual(['DEMO-1']);
  });

  it('a poll in flight when the board is left (aborted) changes nothing and is not a sync', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    const pending = deferred<GetWorkspaceJiraRecentlyUpdatedResult>();
    api.getWorkspaceJiraRecentlyUpdated.mockReturnValueOnce(pending.promise);
    const ctrl = new AbortController();
    const p = pollJiraProject(qc, 'ws-a', 'DEMO', false, ctrl.signal);
    ctrl.abort(); // the user switched workspaces
    pending.resolve({ ok: true, issues: [issue('9', 'DEMO-9', { updated: T0 + 1 })] });
    await expect(p).resolves.toBe('skipped');
    expect(list(KEY_A)).toEqual(['DEMO-1']);
  });

  it('runs a full read instead after a gap longer than the lookback allows (sleep, hidden window)', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1'), issue('2', 'DEMO-2')]);
    vi.setSystemTime(T0 + JIRA_POLL_GAP_LIMIT_MS + 1);
    // DEMO-2 was deleted while the machine slept: only a full read can know.
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'DEMO-1')], priorities: [] });
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('full-refresh');
    expect(api.getWorkspaceJiraRecentlyUpdated).not.toHaveBeenCalled();
    expect(list(KEY_A)).toEqual(['DEMO-1']);

    // The full read restarted the chain: the next poll is incremental again.
    vi.setSystemTime(T0 + JIRA_POLL_GAP_LIMIT_MS + 1 + JIRA_POLL_INTERVAL_MS);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [] });
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('merged');
  });

  it('keeps bridging gaps while each poll succeeds', async () => {
    await load('ws-a', 'DEMO', []);
    for (let n = 1; n <= 12; n++) {
      vi.setSystemTime(T0 + n * JIRA_POLL_INTERVAL_MS);
      api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [] });
      await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('merged');
    }
    expect(api.getWorkspaceJiraIssues).toHaveBeenCalledTimes(1);
  });

  it('a failed poll throws and does not count as a sync, so a long outage ends in a full read', async () => {
    await load('ws-a', 'DEMO', []);
    for (let n = 1; n <= 4; n++) {
      vi.setSystemTime(T0 + n * JIRA_POLL_INTERVAL_MS);
      api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'offline', credentialRef: null });
      await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).rejects.toThrow('offline');
    }
    vi.setSystemTime(T0 + 5 * JIRA_POLL_INTERVAL_MS);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [], priorities: [] });
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('full-refresh');
  });

  it('a rejected credential refreshes the list, which then shows the reconnect state', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    const failure = { ok: false as const, reason: 'unauthorized' as const, message: 'revoked', credentialRef: 'jira-1' };
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce(failure);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce(failure);
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).rejects.toThrow('revoked');
    await vi.waitFor(() => expect(qc.getQueryData(KEY_A)).toEqual(failure));
  });

  it('skips while a full read of the same list is running, so the two never overlap', async () => {
    await load('ws-a', 'DEMO', []);
    const pending = deferred<GetWorkspaceJiraIssuesResult>();
    api.getWorkspaceJiraIssues.mockReturnValueOnce(pending.promise);
    const full = qc.refetchQueries({ queryKey: KEY_A, exact: true });
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('skipped');
    expect(api.getWorkspaceJiraRecentlyUpdated).not.toHaveBeenCalled();
    pending.resolve({ ok: true, issues: [], priorities: [] });
    await full;
  });

  it('discards a poll answer once a later full read has started', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1'), issue('2', 'DEMO-2')]);
    const poll = deferred<GetWorkspaceJiraRecentlyUpdatedResult>();
    api.getWorkspaceJiraRecentlyUpdated.mockReturnValueOnce(poll.promise);
    const p = pollJiraProject(qc, 'ws-a', 'DEMO', false);
    // A full read starts after the poll and finds DEMO-2 deleted.
    vi.setSystemTime(T0 + 1000);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'DEMO-1')], priorities: [] });
    await qc.refetchQueries({ queryKey: KEY_A, exact: true });
    // The poll then answers with the pre-deletion DEMO-2; it must not resurrect it.
    poll.resolve({ ok: true, issues: [issue('2', 'DEMO-2', { updated: T0 + 500 })] });
    await expect(p).resolves.toBe('skipped');
    expect(list(KEY_A)).toEqual(['DEMO-1']);
  });

  it('skips a list that has not loaded yet', async () => {
    await expect(pollJiraProject(qc, 'ws-a', 'DEMO', false)).resolves.toBe('skipped');
    expect(api.getWorkspaceJiraRecentlyUpdated).not.toHaveBeenCalled();
  });
});

describe('fetchFullJiraIssues', () => {
  it('replaces the issue set: deleted and moved-away issues disappear', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1'), issue('2', 'DEMO-2'), issue('3', 'DEMO-3')]);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'DEMO-1')], priorities: [] });
    await qc.refetchQueries({ queryKey: KEY_A, exact: true });
    expect(list(KEY_A)).toEqual(['DEMO-1']);
  });

  it('keeps a newer directly read copy over the older full-search copy', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    applyJiraUpdates(qc, 'ws-a', [issue('1', 'DEMO-1', { summary: 'direct', updated: T0 + 60_000 })]);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'DEMO-1', { summary: 'lagging' })], priorities: [] });
    await qc.refetchQueries({ queryKey: KEY_A, exact: true });
    const d = qc.getQueryData<GetWorkspaceJiraIssuesResult>(KEY_A);
    expect(d?.ok && d.issues[0].summary).toBe('direct');
  });

  it('passes a failure through unchanged', async () => {
    const failure = { ok: false as const, reason: 'error' as const, message: 'down', credentialRef: null };
    api.getWorkspaceJiraIssues.mockResolvedValueOnce(failure);
    await expect(fetchFullJiraIssues(qc, 'ws-a', 'DEMO', false)).resolves.toEqual(failure);
  });
});

describe('the detail panel feeding the board', () => {
  it('a direct read freshens the card, and an older poll answer cannot undo it', async () => {
    await load('ws-a', 'DEMO', [issue('1', 'DEMO-1')]);
    const detail: IssueDetail = { ...issue('1', 'DEMO-1', { summary: 'From Jira itself', updated: T0 + 90_000 }), project: { id: '10000', name: 'Demo', shortName: 'DEMO' } };
    const board = boardIssueOf(detail);
    expect('project' in board).toBe(false);
    applyJiraUpdates(qc, 'ws-a', [board]);

    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [issue('1', 'DEMO-1', { summary: 'search index', updated: T0 + 10_000 })] });
    await pollJiraProject(qc, 'ws-a', 'DEMO', false);
    const d = qc.getQueryData<GetWorkspaceJiraIssuesResult>(KEY_A);
    expect(d?.ok && d.issues[0].summary).toBe('From Jira itself');
  });
});

describe('read-only', () => {
  it('uses no window.vermilian call but the two Jira reads', async () => {
    const calls: string[] = [];
    const spy = new Proxy(api, {
      get(target, prop: string) {
        calls.push(prop);
        return target[prop as keyof typeof api];
      },
    });
    (globalThis as unknown as { window: unknown }).window = { vermilian: spy };
    await load('ws-a', 'DEMO', []);
    api.getWorkspaceJiraRecentlyUpdated.mockResolvedValueOnce({ ok: true, issues: [] });
    await pollJiraProject(qc, 'ws-a', 'DEMO', false);
    vi.setSystemTime(T0 + 60 * 60_000);
    api.getWorkspaceJiraIssues.mockResolvedValueOnce({ ok: true, issues: [], priorities: [] });
    await pollJiraProject(qc, 'ws-a', 'DEMO', false);
    expect(new Set(calls)).toEqual(new Set(['getWorkspaceJiraIssues', 'getWorkspaceJiraRecentlyUpdated']));
  });
});

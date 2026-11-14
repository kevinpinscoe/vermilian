import { describe, expect, it } from 'vitest';
import type * as YouTrackClient from '../api/youtrack';
import { createYouTrackProvider } from './youtrackProvider';
import { isWritableTracker } from '../../shared/tracker';

// Fictional values only (ADR-0011 §10).
const URL = 'https://youtrack.example.com';
const TOKEN = 'perm:fictional';

type Call = { name: string; args: unknown[] };

// A stub client that records every call and returns a marker per method, so
// each provider method can be checked to reach exactly one client function
// with the bound URL and token first and its own arguments unchanged.
function recordingClient(): { client: typeof YouTrackClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) =>
      (...args: unknown[]) => {
        calls.push({ name, args });
        return Promise.resolve(`result:${name}`);
      },
  }) as unknown as typeof YouTrackClient;
  return { client, calls };
}

describe('createYouTrackProvider', () => {
  const cases: Array<[string, (p: ReturnType<typeof createYouTrackProvider>) => Promise<unknown>, string, unknown[]]> = [
    ['getCurrentUser', (p) => p.getCurrentUser(), 'getCurrentUser', []],
    ['getProjects', (p) => p.getProjects(), 'getProjects', []],
    ['getIssues', (p) => p.getIssues('DEMO', true), 'getIssues', ['DEMO', true]],
    ['searchIssues', (p) => p.searchIssues(['DEMO', 'OPS'], 'bug'), 'searchIssues', [['DEMO', 'OPS'], 'bug']],
    ['getIssueDetail', (p) => p.getIssueDetail('DEMO-1'), 'getIssueDetail', ['DEMO-1']],
    ['patchIssue', (p) => p.patchIssue('DEMO-1', 'Priority', 'Major'), 'patchIssue', ['DEMO-1', 'Priority', 'Major']],
    ['postComment', (p) => p.postComment('DEMO-1', 'hello'), 'postComment', ['DEMO-1', 'hello']],
    ['moveIssue', (p) => p.moveIssue('DEMO-1', '0-7'), 'moveIssue', ['DEMO-1', '0-7']],
    ['deleteIssue', (p) => p.deleteIssue('DEMO-1'), 'deleteIssue', ['DEMO-1']],
    ['postWorklog', (p) => p.postWorklog('DEMO-1', 25, 'Development'), 'postWorklog', ['DEMO-1', 25, 'Development']],
    ['getWorklogTypes', (p) => p.getWorklogTypes(), 'getWorklogTypes', []],
    [
      'createIssue',
      (p) => p.createIssue({ projectId: '0-1', summary: 'S' } as YouTrackClient.CreateIssuePayload),
      'createIssue',
      [{ projectId: '0-1', summary: 'S' }],
    ],
    ['getIssuesForRecommendation', (p) => p.getIssuesForRecommendation(['DEMO-1']), 'getIssuesForRecommendation', [['DEMO-1']]],
    ['getIssuesForStandup', (p) => p.getIssuesForStandup(['DEMO'], 1000), 'getIssuesForStandup', [['DEMO'], 1000]],
  ];

  it.each(cases)('%s delegates to the client with the bound URL and token', async (_n, call, clientFn, args) => {
    const { client, calls } = recordingClient();
    const result = await call(createYouTrackProvider(client, URL, TOKEN));
    expect(calls).toEqual([{ name: clientFn, args: [URL, TOKEN, ...args] }]);
    expect(result).toBe(`result:${clientFn}`);
  });

  it('leaves includeResolved to the client default when omitted', async () => {
    const { client, calls } = recordingClient();
    await createYouTrackProvider(client, URL, TOKEN).getIssues('DEMO');
    expect(calls[0].args).toEqual([URL, TOKEN, 'DEMO', undefined]);
  });

  it('propagates client errors unchanged', async () => {
    const err = { status: 401, message: 'Unauthorized' };
    const client = { getProjects: () => Promise.reject(err) } as unknown as typeof YouTrackClient;
    await expect(createYouTrackProvider(client, URL, TOKEN).getProjects()).rejects.toBe(err);
  });

  it('is a writable youtrack provider', () => {
    const p = createYouTrackProvider(recordingClient().client, URL, TOKEN);
    expect(p.kind).toBe('youtrack');
    expect(isWritableTracker(p)).toBe(true);
  });
});

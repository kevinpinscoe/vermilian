import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '../../shared/config';
import type { RunwayItem } from '../../shared/runwayItem';
import type { BoardIssue } from '../../shared/workspace';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../../shared/workspaceSchema';
import * as fakeJira from '../api/fakeJira';
import { createJiraProvider } from '../providers/jiraProvider';
import { createYouTrackProvider } from '../providers/youtrackProvider';
import type { CredentialSourceIO } from './credentialResolver';
import type { RunwayWorkspaces } from './runwayItemIpc';
import {
  RUNWAY_BATCH_SIZE,
  createRunwayTicketFetch,
  jiraRunwayReader,
  readRunwayTickets,
  youtrackRunwayReader,
  type RunwayReaderResult,
  type RunwayTicketReader,
} from './runwayTicketFetch';
import { resolveWorkspaceYouTrackConnection } from './workspaceYouTrack';

// Synthetic keys, names and hosts only.
const YT_WS = 'ws-a1b2c3d4e5f6';
const JIRA_WS = 'ws-0f1e2d3c4b5a';
const OTHER_WS = 'ws-999999999999';

function issue(idReadable: string, summary = `Summary of ${idReadable}`): BoardIssue {
  return { id: `id-${idReadable}`, idReadable, summary, resolved: null, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}

function row(workspaceId: string, itemId: string, kind: RunwayItem['kind'] = 'issue', position = 1): RunwayItem {
  return {
    workspaceId,
    itemId,
    kind,
    position,
    runwayNumber: kind === 'issue' ? position : null,
    depth: 0,
    text: kind === 'issue' ? null : 'text',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const err = (status?: number, message = 'refused') => (status === undefined ? { message } : { status, message });

/** A reader over a fixed set of issues, with a spy on every call. */
function fakeReader(
  known: Record<string, BoardIssue>,
  opts: { batchError?: unknown; singleErrors?: Record<string, unknown>; omitFromBatch?: string[] } = {},
) {
  const batch = vi.fn(async (ids: readonly string[]) => {
    if (opts.batchError) throw opts.batchError;
    if (ids.some((id) => !known[id])) throw err(400, "Can't parse search query");
    return ids.filter((id) => !opts.omitFromBatch?.includes(id)).map((id) => known[id]);
  });
  const one = vi.fn(async (id: string) => {
    if (opts.singleErrors?.[id]) throw opts.singleErrors[id];
    if (!known[id]) throw err(404, `Entity with id ${id} not found`);
    return known[id];
  });
  const reader: RunwayTicketReader = { batch, one };
  return { reader, batch, one };
}

const KNOWN = { 'READ-12': issue('READ-12'), 'READ-20': issue('READ-20'), 'SYNC-3': issue('SYNC-3') };

describe('readRunwayTickets', () => {
  it('resolves YouTrack tickets in one batch, in Runway order', async () => {
    const f = fakeReader(KNOWN);
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:SYNC-3', 'yt:READ-12', 'yt:READ-20']);
    expect(reads.map((r) => [r.itemId, r.state])).toEqual([
      ['yt:SYNC-3', 'resolved'],
      ['yt:READ-12', 'resolved'],
      ['yt:READ-20', 'resolved'],
    ]);
    expect(f.batch).toHaveBeenCalledTimes(1);
    expect(f.one).not.toHaveBeenCalled();
  });

  it('a batch failed by one unknown ID retries each ticket, so readable ones still load', async () => {
    const f = fakeReader(KNOWN);
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:GONE-1', 'yt:READ-20']);
    expect(reads).toEqual([
      { itemId: 'yt:READ-12', state: 'resolved', issue: KNOWN['READ-12'] },
      { itemId: 'yt:GONE-1', state: 'missing-or-unreadable' },
      { itemId: 'yt:READ-20', state: 'resolved', issue: KNOWN['READ-20'] },
    ]);
    expect(f.one).toHaveBeenCalledTimes(3);
  });

  it('a 404 keeps the row: every Runway row gets a state, none is dropped', async () => {
    const f = fakeReader({});
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:GONE-1', 'yt:GONE-2']);
    expect(reads.map((r) => r.state)).toEqual(['missing-or-unreadable', 'missing-or-unreadable']);
  });

  it('an explicit refusal (403) is Not readable; 410 is Missing', async () => {
    const f = fakeReader(KNOWN, { batchError: err(403), singleErrors: { 'READ-20': err(403, 'You have no access'), 'SYNC-3': err(410, 'Gone') } });
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:READ-20', 'yt:SYNC-3']);
    expect(reads).toEqual([
      { itemId: 'yt:READ-12', state: 'resolved', issue: KNOWN['READ-12'] },
      { itemId: 'yt:READ-20', state: 'not-readable', reason: 'You have no access' },
      { itemId: 'yt:SYNC-3', state: 'missing' },
    ]);
  });

  it('a ticket a successful batch did not return is read on its own', async () => {
    const f = fakeReader(KNOWN, { omitFromBatch: ['READ-20'], singleErrors: { 'READ-20': err(404) } });
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:READ-20']);
    expect(reads.map((r) => r.state)).toEqual(['resolved', 'missing-or-unreadable']);
    expect(f.one).toHaveBeenCalledTimes(1);
    expect(f.one).toHaveBeenCalledWith('READ-20');
  });

  it('401 on the batch is one workspace error, with no single retries', async () => {
    const f = fakeReader(KNOWN, { batchError: err(401, 'Unauthorized') });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:READ-20'])).rejects.toMatchObject({ code: 'unauthorized' });
    expect(f.one).not.toHaveBeenCalled();
  });

  it('401 during the single reads stops them and fails the workspace', async () => {
    const f = fakeReader(KNOWN, { singleErrors: { 'READ-12': err(401, 'Unauthorized') } });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:GONE-1'])).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it.each([[undefined], [500], [503], [429]])('a network or server failure (%s) is a refresh error', async (status) => {
    const f = fakeReader(KNOWN, { batchError: err(status, 'fetch failed') });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12'])).rejects.toMatchObject({ code: 'refresh-failed' });
    expect(f.one).not.toHaveBeenCalled();
  });

  it('reads in batches of RUNWAY_BATCH_SIZE', async () => {
    const known = Object.fromEntries(Array.from({ length: RUNWAY_BATCH_SIZE + 1 }, (_, i) => [`READ-${i + 1}`, issue(`READ-${i + 1}`)]));
    const f = fakeReader(known);
    const reads = await readRunwayTickets('youtrack', f.reader, Object.keys(known).map((k) => `yt:${k}`));
    expect(reads).toHaveLength(RUNWAY_BATCH_SIZE + 1);
    expect(f.batch.mock.calls.map((c) => c[0].length)).toEqual([RUNWAY_BATCH_SIZE, 1]);
  });

  it('keeps a row from the other tracker in place, unread, and reads the rest', async () => {
    const f = fakeReader(KNOWN);
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'jira:PLAT-40', 'yt:READ-20']);
    expect(reads).toEqual([
      { itemId: 'yt:READ-12', state: 'resolved', issue: KNOWN['READ-12'] },
      { itemId: 'jira:PLAT-40', state: 'wrong-tracker', reason: 'PLAT-40 is a Jira ticket; this workspace reads YouTrack only.' },
      { itemId: 'yt:READ-20', state: 'resolved', issue: KNOWN['READ-20'] },
    ]);
    expect(f.batch.mock.calls).toEqual([[['READ-12', 'READ-20']]]);
    expect(f.one).not.toHaveBeenCalled();
  });

  it('keeps a YouTrack row on a Jira workspace, and a row whose ID is not a ticket ID', async () => {
    const f = fakeReader({});
    const reads = await readRunwayTickets('jira', f.reader, ['yt:READ-12', 'sec:abc']);
    expect(reads).toEqual([
      { itemId: 'yt:READ-12', state: 'wrong-tracker', reason: 'READ-12 is a YouTrack ticket; this workspace reads Jira only.' },
      { itemId: 'sec:abc', state: 'wrong-tracker', reason: 'sec:abc is not a YouTrack or Jira ticket ID.' },
    ]);
    expect(f.batch).not.toHaveBeenCalled();
    expect(f.one).not.toHaveBeenCalled();
  });
});

describe('error classification: only 403, 404 and 410 are ticket states', () => {
  it.each([[400], [403], [404]])('a batch answered %i is retried one ticket at a time', async (status) => {
    const f = fakeReader(KNOWN, { batchError: err(status) });
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12']);
    expect(reads.map((r) => r.state)).toEqual(['resolved']);
    expect(f.one).toHaveBeenCalledTimes(1);
  });

  it.each([[408], [410], [409], [502], [504]])('a batch answered %i is a refresh error, with no single reads', async (status) => {
    const f = fakeReader(KNOWN, { batchError: err(status) });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12'])).rejects.toMatchObject({ code: 'refresh-failed' });
    expect(f.one).not.toHaveBeenCalled();
  });

  it.each([[400], [408], [409], [422], [429], [500], [504], [undefined]])(
    'a single read answered %s is a refresh error, never a ticket state',
    async (status) => {
      const f = fakeReader(KNOWN, { batchError: err(400), singleErrors: { 'READ-20': err(status) } });
      await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'yt:READ-20'])).rejects.toMatchObject({ code: 'refresh-failed' });
    },
  );

  it.each([
    ['a TimeoutError', { name: 'TimeoutError', message: 'The operation was aborted due to timeout' }],
    ['an AbortError', { name: 'AbortError', message: 'This operation was aborted' }],
    ['a connect timeout', { name: 'TypeError', message: 'fetch failed', cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }],
    ['a 408', { status: 408, message: 'Request Timeout' }],
    ['a 504', { status: 504, message: 'Gateway Timeout' }],
  ])('%s is a refresh error that says the tracker did not answer in time', async (_label, timeout) => {
    const batchTimeout = fakeReader(KNOWN, { batchError: timeout });
    await expect(readRunwayTickets('youtrack', batchTimeout.reader, ['yt:READ-12'])).rejects.toMatchObject({
      code: 'refresh-failed',
      message: 'The Runway could not be refreshed: the tracker did not answer in time',
    });
    const singleTimeout = fakeReader(KNOWN, { batchError: err(400), singleErrors: { 'READ-12': timeout } });
    await expect(readRunwayTickets('youtrack', singleTimeout.reader, ['yt:READ-12'])).rejects.toMatchObject({
      code: 'refresh-failed',
      message: 'The Runway could not be refreshed: the tracker did not answer in time',
    });
  });

  it('a network failure without a timeout says the tracker could not be reached', async () => {
    const f = fakeReader(KNOWN, { batchError: { name: 'TypeError', message: '' } });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12'])).rejects.toMatchObject({
      code: 'refresh-failed',
      message: 'The Runway could not be refreshed: the tracker could not be reached',
    });
  });

  it('401 wins over refresh errors: it is reported as unauthorized', async () => {
    const f = fakeReader(KNOWN, { batchError: err(400), singleErrors: { 'READ-12': err(401, 'Unauthorized') } });
    await expect(readRunwayTickets('youtrack', f.reader, ['yt:READ-12'])).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('Jira Runway reads (fake Jira)', () => {
  const provider = () => createJiraProvider(fakeJira as never, { base: 'https://jira.example.test', email: 'a@example.test', token: 'e2e-jira-token' });
  const scope = (admitted: string[]) => ({
    projectKeys: ['DEMO'],
    boardIds: [],
    isOnBoard: async () => false,
    isOnRunway: (key: string) => admitted.includes(key),
  });

  it('resolves Jira Runway tickets, including one outside the projects', async () => {
    const reads = await readRunwayTickets('jira', jiraRunwayReader(provider(), scope(['OPS-7'])), ['jira:OPS-7', 'jira:DEMO-101']);
    expect(reads.map((r) => [r.itemId, r.state, r.state === 'resolved' ? r.issue.idReadable : null])).toEqual([
      ['jira:OPS-7', 'resolved', 'OPS-7'],
      ['jira:DEMO-101', 'resolved', 'DEMO-101'],
    ]);
  });

  it('an unknown key fails the batch, then reads as Missing or not readable while the rest load', async () => {
    const reads = await readRunwayTickets('jira', jiraRunwayReader(provider(), scope(['DEMO-999'])), ['jira:DEMO-101', 'jira:DEMO-999']);
    expect(reads.map((r) => r.state)).toEqual(['resolved', 'missing-or-unreadable']);
  });

  it('a ticket that moved to a key the workspace may not read is Not readable', async () => {
    const moved = issue('PLAT-40');
    const reader = jiraRunwayReader({ getIssuesByKeys: async () => [moved], getBoardIssue: async () => moved }, scope(['DEMO-5']));
    const reads = await readRunwayTickets('jira', reader, ['jira:DEMO-5']);
    expect(reads).toEqual([{ itemId: 'jira:DEMO-5', state: 'not-readable', reason: expect.stringMatching(/moved to PLAT-40/) }]);
  });

  it('a revoked token is one unauthorized error', async () => {
    const bad = createJiraProvider(fakeJira as never, { base: 'https://jira.example.test', email: 'a@example.test', token: fakeJira.FAKE_JIRA_BAD_TOKEN });
    await expect(readRunwayTickets('jira', jiraRunwayReader(bad, scope([])), ['jira:DEMO-101'])).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('createRunwayTicketFetch', () => {
  const WORKSPACES: RunwayWorkspaces = {
    activeId: YT_WS,
    workspaces: [
      { id: YT_WS, backend: { kind: 'youtrack' } },
      { id: JIRA_WS, backend: { kind: 'jira' } },
      { id: OTHER_WS, backend: { kind: 'youtrack' } },
    ],
  };
  const ITEMS: Record<string, RunwayItem[]> = {
    [YT_WS]: [row(YT_WS, 'sec:s1', 'section', 1), row(YT_WS, 'yt:READ-12', 'issue', 2), row(YT_WS, 'note:n1', 'note', 3), row(YT_WS, 'yt:READ-20', 'issue', 4)],
    [JIRA_WS]: [],
  };

  function deps(reader: (ws: string, tracker: string) => Promise<RunwayReaderResult>) {
    const spy = vi.fn(reader);
    const fetch = createRunwayTicketFetch({
      workspaces: async () => WORKSPACES,
      items: (ws) => ITEMS[ws] ?? [],
      reader: spy,
    });
    return { fetch, spy };
  }

  it("reads ticket rows only, on the workspace's own reader, opened once", async () => {
    const f = fakeReader(KNOWN, { omitFromBatch: ['READ-20'], singleErrors: { 'READ-20': err(403) } });
    const d = deps(async () => ({ ok: true, reader: f.reader }));
    const r = await d.fetch({ workspaceId: YT_WS });
    expect(r).toEqual({
      ok: true,
      tickets: [
        { itemId: 'yt:READ-12', state: 'resolved', issue: KNOWN['READ-12'] },
        { itemId: 'yt:READ-20', state: 'not-readable', reason: 'refused' },
      ],
    });
    expect(d.spy.mock.calls).toEqual([[YT_WS, 'youtrack']]);
  });

  it('a reader that cannot be opened fails the read with no ticket requests', async () => {
    const d = deps(async () => ({ ok: false, code: 'credential', error: 'YouTrack is unavailable for this workspace: youtrack-home did not resolve' }));
    await expect(d.fetch({ workspaceId: YT_WS })).resolves.toEqual({
      ok: false,
      code: 'credential',
      error: 'YouTrack is unavailable for this workspace: youtrack-home did not resolve',
    });
    expect(d.spy).toHaveBeenCalledTimes(1);
  });

  it('a Runway of only other-tracker rows keeps them and opens no connection', async () => {
    const d = deps(async () => { throw new Error('must not be called'); });
    ITEMS[OTHER_WS] = [row(OTHER_WS, 'jira:PLAT-40', 'issue', 1), row(OTHER_WS, 'sec:s1', 'section', 2)];
    await expect(d.fetch({ workspaceId: OTHER_WS })).resolves.toEqual({
      ok: true,
      tickets: [{ itemId: 'jira:PLAT-40', state: 'wrong-tracker', reason: 'PLAT-40 is a Jira ticket; this workspace reads YouTrack only.' }],
    });
    expect(d.spy).not.toHaveBeenCalled();
  });

  it('an empty Runway opens no connection', async () => {
    const d = deps(async () => { throw new Error('must not be called'); });
    await expect(d.fetch({ workspaceId: JIRA_WS })).resolves.toEqual({ ok: true, tickets: [] });
    expect(d.spy).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'invalid-args'],
    [{ workspaceId: '' }, 'invalid-workspace'],
    [{ workspaceId: 'ws-000000000000' }, 'unknown-workspace'],
  ])('refuses %j', async (args, code) => {
    const d = deps(async () => { throw new Error('must not be called'); });
    await expect(d.fetch(args)).resolves.toMatchObject({ ok: false, code });
    expect(d.spy).not.toHaveBeenCalled();
  });

  it('a 401 is one workspace-level error', async () => {
    const f = fakeReader(KNOWN, { batchError: err(401, 'Unauthorized') });
    const d = deps(async () => ({ ok: true, reader: f.reader }));
    await expect(d.fetch({ workspaceId: YT_WS })).resolves.toMatchObject({ ok: false, code: 'unauthorized' });
    expect(f.one).not.toHaveBeenCalled();
  });
});

describe("credential isolation: a Runway ticket is read with its own workspace's credential only", () => {
  const CFG: AppConfig = {
    ...DEFAULT_CONFIG,
    youtrackTokenCommand: 'show settings token',
    credentialSources: {
      'youtrack-home': { command: 'show home', file: '' },
      'youtrack-other': { command: 'show other', file: '' },
    },
  };
  const doc = (workspaceId: string, credentialRef: string): WorkspaceDocument => ({
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name: 'Ship the offline reader',
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'https://yt.example.test', credentialRef },
    ai: { credentialRef: null },
    folders: [],
    boards: {},
    dismissals: {},
  });
  const DOCS: Record<string, WorkspaceDocument> = { [YT_WS]: doc(YT_WS, 'youtrack-home'), [OTHER_WS]: doc(OTHER_WS, 'youtrack-other') };

  it('an unreadable ticket yields Not readable, and no other credential is resolved or used', async () => {
    // The resolver spy: every credential source the resolver touches.
    const resolved: string[] = [];
    const io: CredentialSourceIO = {
      async runCommand(c) {
        resolved.push(c);
        return { ok: true, stdout: c === 'show home' ? 'fictional-home-token' : c === 'show other' ? 'fictional-other-token' : 'fictional-settings-token' };
      },
      async readFile(f) { resolved.push(`file:${f}`); return { ok: false }; },
      async blobPresent() { return false; },
      async readBlob() { return { ok: false }; },
    };
    // The tracker spy: which token every request carried.
    const tokens: string[] = [];
    const client = {
      getIssuesByIds: async (_url: string, token: string) => { tokens.push(token); throw err(400); },
      getBoardIssue: async (_url: string, token: string, id: string) => {
        tokens.push(token);
        if (id === 'READ-12') return KNOWN['READ-12'];
        throw err(403, 'No access to READ-20');
      },
    };
    const fetch = createRunwayTicketFetch({
      workspaces: async () => ({ activeId: OTHER_WS, workspaces: [{ id: YT_WS }, { id: OTHER_WS }] }),
      items: () => [row(YT_WS, 'yt:READ-12', 'issue', 1), row(YT_WS, 'yt:READ-20', 'issue', 2)],
      async reader(workspaceId) {
        const yt = await resolveWorkspaceYouTrackConnection(DOCS[workspaceId] ?? null, CFG, io, false);
        if (!yt.ok) return { ok: false, code: 'credential', error: yt.error };
        return { ok: true, reader: youtrackRunwayReader(createYouTrackProvider(client as never, yt.url, yt.token)) };
      },
    });

    const r = await fetch({ workspaceId: YT_WS });
    expect(r).toEqual({
      ok: true,
      tickets: [
        { itemId: 'yt:READ-12', state: 'resolved', issue: KNOWN['READ-12'] },
        { itemId: 'yt:READ-20', state: 'not-readable', reason: 'No access to READ-20' },
      ],
    });
    expect(resolved).toEqual(['show home']);
    expect(new Set(tokens)).toEqual(new Set(['fictional-home-token']));
  });
});

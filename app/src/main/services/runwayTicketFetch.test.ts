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

  it('ignores rows that are not tickets on this tracker', async () => {
    const f = fakeReader(KNOWN);
    const reads = await readRunwayTickets('youtrack', f.reader, ['yt:READ-12', 'jira:READ-20', 'sec:abc']);
    expect(reads.map((r) => r.itemId)).toEqual(['yt:READ-12']);
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

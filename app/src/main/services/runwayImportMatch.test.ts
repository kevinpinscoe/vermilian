import { describe, expect, it, vi } from 'vitest';
import type { TrackerKind } from '../../shared/tracker';
import type { BoardIssue } from '../../shared/workspace';
import { parseRunwaySchedule } from '../../shared/runwaySchedule';
import { scheduleCandidates, type RunwayImportCandidate, type RunwayImportGroupMatch, type RunwayImportMatchResult } from '../../shared/runwayImport';
import type { RunwayWorkspaces } from './runwayItemIpc';
import type { RunwayReaderResult, RunwayTicketReader } from './runwayTicketFetch';
import { createRunwayImportMatch, validateImportMatchArgs, type RunwayImportMatchDeps } from './runwayImportMatch';

// Synthetic keys, names and hosts only.
const YT_A = 'ws-aaaaaaaaaaaa';
const YT_B = 'ws-bbbbbbbbbbbb';
const JIRA = 'ws-cccccccccccc';
const LEGACY = 'ws-dddddddddddd';
const YT_PATH = 'ws-eeeeeeeeeeee';

const BASE: Record<string, string> = {
  [YT_A]: 'https://yt.example.test',
  [YT_B]: 'https://yt2.example.test',
  [JIRA]: 'https://site.example.test',
  [LEGACY]: 'https://legacy.example.test',
  [YT_PATH]: 'https://tracker.example.test/youtrack',
};

const CONFIG: RunwayWorkspaces = {
  activeId: YT_A,
  workspaces: [
    { id: YT_A, backend: { kind: 'youtrack' } },
    { id: YT_B, backend: { kind: 'youtrack' } },
    { id: JIRA, backend: { kind: 'jira' } },
    { id: LEGACY },
    { id: YT_PATH, backend: { kind: 'youtrack' } },
  ],
};

function issue(idReadable: string, summary = `Summary of ${idReadable}`, id = `id-${idReadable}`): BoardIssue {
  return { id, idReadable, summary, resolved: null, fields: {} as BoardIssue['fields'], parentEpic: null, isEpic: false };
}

const err = (status?: number, message = 'refused') => (status === undefined ? { message } : { status, message });

/** A reader over fixed issues: batch returns what it knows, single reads answer by `answers`. */
function fakeReader(known: Record<string, BoardIssue>, opts: { batchError?: unknown; answers?: Record<string, BoardIssue | { status?: number; message: string }>; hang?: boolean } = {}) {
  const batch = vi.fn(async (ids: readonly string[]) => {
    if (opts.hang) return new Promise<BoardIssue[]>(() => undefined);
    if (opts.batchError) throw opts.batchError;
    return ids.flatMap((id) => (known[id] ? [known[id]] : []));
  });
  const one = vi.fn(async (id: string) => {
    const a = opts.answers?.[id];
    if (a && 'idReadable' in a) return a;
    if (a) throw a;
    if (known[id]) return known[id];
    throw err(404, `Entity with id ${id} not found`);
  });
  const admits = vi.fn(async () => true);
  const reader: RunwayTicketReader = { batch, one, admits };
  return { reader, batch, one, admits };
}

function deps(readers: Partial<Record<string, RunwayReaderResult>>, extra: Partial<RunwayImportMatchDeps> = {}) {
  const reader = vi.fn(async (workspaceId: string, _tracker: TrackerKind): Promise<RunwayReaderResult> => {
    return readers[workspaceId] ?? { ok: false, code: 'credential', error: 'no reader in this test' };
  });
  const d: RunwayImportMatchDeps = {
    workspaces: async () => CONFIG,
    trackerBaseUrl: async (workspaceId) => BASE[workspaceId] ?? '',
    reader,
    ...extra,
  };
  return { d, reader };
}

const sched = (text: string, line: number): RunwayImportCandidate => ({ text, line, role: 'scheduled', reason: null });
const ref = (text: string, line: number, reason: RunwayImportCandidate['reason'] = 'prose'): RunwayImportCandidate => ({ text, line, role: 'reference', reason });

function okGroups(r: RunwayImportMatchResult): RunwayImportGroupMatch[] {
  if (!r.ok) throw new Error(`match failed: ${r.error}`);
  return r.groups;
}

/** Each candidate as `L<line> <role> <status> <key or code>`. */
function summary(g: RunwayImportGroupMatch): string[] {
  if (!g.ok) throw new Error(`group failed: ${g.error}`);
  return g.candidates.map((c) => {
    const what = c.status === 'unmatched' ? c.code : c.ticket.key + (c.status === 'duplicate' ? ` of L${c.duplicateOfLine}` : '');
    return `L${c.line} ${c.role}${c.reason ? `/${c.reason}` : ''} ${c.status} ${what}`;
  });
}

describe('runwayImportMatch — Kevin’s regressions', () => {
  it('line 1 See OPS-7, line 3 its same-host link, line 5 the bare key: one lookup, a reference, a match and a duplicate', async () => {
    const file = ['See OPS-7.', '', '- https://site.example.test/browse/OPS-7 Fix the pager', '', '- OPS-7 Again'].join('\n');
    const group = parseRunwaySchedule(file).groups[0];
    const candidates = scheduleCandidates(group);
    expect(candidates).toEqual([ref('OPS-7', 1, 'prose'), sched('https://site.example.test/browse/OPS-7', 3), sched('OPS-7', 5)]);

    const r = fakeReader({ 'OPS-7': issue('OPS-7', 'Pager') });
    const { d } = deps({ [JIRA]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g1', workspaceId: JIRA, candidates }] }));

    expect(r.batch).toHaveBeenCalledTimes(1);
    expect(r.batch).toHaveBeenCalledWith(['OPS-7']);
    expect(r.one).not.toHaveBeenCalled();
    expect(summary(g)).toEqual(['L1 reference/prose matched OPS-7', 'L3 scheduled matched OPS-7', 'L5 scheduled duplicate OPS-7 of L3']);
  });

  it('the same key in two groups mapped to different workspaces uses each one’s own connection and keeps its own result', async () => {
    const a = fakeReader({ 'READ-1': issue('READ-1', 'From A') });
    const b = fakeReader({}); // B's credential cannot see READ-1
    const { d, reader } = deps({ [YT_A]: { ok: true, reader: a.reader }, [YT_B]: { ok: true, reader: b.reader } });
    const groups = okGroups(
      await createRunwayImportMatch(d)({
        groups: [
          { groupKey: 'alpha', workspaceId: YT_A, candidates: [sched('READ-1', 2)] },
          { groupKey: 'beta', workspaceId: YT_B, candidates: [sched('READ-1', 5)] },
        ],
      }),
    );
    expect(reader.mock.calls).toEqual([
      [YT_A, 'youtrack'],
      [YT_B, 'youtrack'],
    ]);
    expect(a.batch).toHaveBeenCalledWith(['READ-1']);
    expect(b.batch).toHaveBeenCalledWith(['READ-1']);
    expect(groups.map((g) => [g.groupKey, g.workspaceId])).toEqual([
      ['alpha', YT_A],
      ['beta', YT_B],
    ]);
    expect(summary(groups[0])).toEqual(['L2 scheduled matched READ-1']);
    expect(groups[0].ok && groups[0].candidates[0].status === 'matched' && groups[0].candidates[0].ticket.summary).toBe('From A');
    expect(summary(groups[1])).toEqual(['L5 scheduled unmatched missing-or-unreadable']);
  });
});

describe('runwayImportMatch — PR 229 review corrections', () => {
  it('a refused link does not take a valid scheduled ticket’s place: the parser’s duplicate stays scheduled until validated', async () => {
    const file = ['- https://tracker.example.test/other/issue/OPS-7', '- https://tracker.example.test/youtrack/issue/OPS-7'].join('\n');
    const group = parseRunwaySchedule(file).groups[0];
    // Same host and key, so the parser records line 2 as a duplicate.
    expect(group.references.map((r) => [r.line, r.reason])).toEqual([[2, 'duplicate']]);
    const candidates = scheduleCandidates(group);
    expect(candidates).toEqual([
      sched('https://tracker.example.test/other/issue/OPS-7', 1),
      sched('https://tracker.example.test/youtrack/issue/OPS-7', 2),
    ]);

    const r = fakeReader({ 'OPS-7': issue('OPS-7') });
    const { d } = deps({ [YT_PATH]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_PATH, candidates }] }));
    expect(summary(g)).toEqual(['L1 scheduled unmatched not-a-ticket-url', 'L2 scheduled matched OPS-7']);
  });

  it('two identical valid scheduled lines: the second is a duplicate pointing back to the first', async () => {
    const group = parseRunwaySchedule(['- OPS-7', '- OPS-7'].join('\n')).groups[0];
    const candidates = scheduleCandidates(group);
    expect(candidates).toEqual([sched('OPS-7', 1), sched('OPS-7', 2)]);

    const r = fakeReader({ 'OPS-7': issue('OPS-7') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates }] }));
    expect(r.batch).toHaveBeenCalledWith(['OPS-7']);
    expect(summary(g)).toEqual(['L1 scheduled matched OPS-7', 'L2 scheduled duplicate OPS-7 of L1']);
  });

  it('a parser duplicate sent as a reference is still treated as scheduled', async () => {
    const r = fakeReader({ 'OPS-7': issue('OPS-7') });
    const { d } = deps({ [YT_PATH]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [
          {
            groupKey: 'g',
            workspaceId: YT_PATH,
            candidates: [
              sched('https://tracker.example.test/other/issue/OPS-7', 1),
              ref('https://tracker.example.test/youtrack/issue/OPS-7', 2, 'duplicate'),
              ref('OPS-7', 3, 'duplicate'),
            ],
          },
        ],
      }),
    );
    expect(summary(g)).toEqual(['L1 scheduled unmatched not-a-ticket-url', 'L2 scheduled matched OPS-7', 'L3 scheduled duplicate OPS-7 of L2']);
  });

  it('a malformed percent-escape in a same-host link is refused alone; the rest of the group is looked up', async () => {
    const r = fakeReader({ 'OPS-7': issue('OPS-7') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('https://yt.example.test/issue/%ZZ', 1), sched('OPS-7', 2)] }],
      }),
    );
    expect(r.batch).toHaveBeenCalledTimes(1);
    expect(r.batch).toHaveBeenCalledWith(['OPS-7']);
    expect(summary(g)).toEqual(['L1 scheduled unmatched not-a-ticket-url', 'L2 scheduled matched OPS-7']);
  });

  it('a held moved-key admission check is bounded by the deadline: one retryable group error, nothing classified', async () => {
    const r = fakeReader({}, { answers: { 'OLD-1': issue('NEW-1') } });
    r.admits.mockImplementation(() => new Promise<boolean>(() => undefined));
    const { d } = deps({ [JIRA]: { ok: true, reader: r.reader } }, { timeoutMs: 5 });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: JIRA, candidates: [sched('OLD-1', 1)] }] }));
    expect(r.one).toHaveBeenCalledWith('OLD-1');
    expect(r.admits).toHaveBeenCalledWith('NEW-1');
    expect(g).toMatchObject({ ok: false, code: 'refresh-failed', retryable: true });
    expect(g.ok ? '' : g.error).toMatch(/did not answer in time.*try again/);
    expect('candidates' in g).toBe(false);
  });

  it.each([
    [true, 'L1 scheduled matched NEW-1'],
    [false, 'L1 scheduled unmatched not-readable'],
  ])('the workspace admission rule for a moved key still applies (admits %s)', async (admitted, expected) => {
    const r = fakeReader({}, { answers: { 'OLD-1': issue('NEW-1') } });
    r.admits.mockResolvedValue(admitted);
    const { d } = deps({ [JIRA]: { ok: true, reader: r.reader } }, { timeoutMs: 1000 });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: JIRA, candidates: [sched('OLD-1', 1)] }] }));
    expect(summary(g)).toEqual([expected]);
  });
});

describe('runwayImportMatch — validation before combining', () => {
  it('a foreign-host link keeps its refusal even when its key is also a valid bare key', async () => {
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('https://other.example.test/issue/READ-1', 2), sched('READ-1', 3)] }],
      }),
    );
    expect(summary(g)).toEqual(['L2 scheduled unmatched foreign-host', 'L3 scheduled matched READ-1']);
  });

  it('a same-host link and its bare key are one ticket once both are validated', async () => {
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('READ-1', 2), sched('https://yt.example.test/issue/READ-1/slug', 3)] }],
      }),
    );
    expect(summary(g)).toEqual(['L2 scheduled matched READ-1', 'L3 scheduled duplicate READ-1 of L2']);
  });

  it('a Jira link on a YouTrack workspace is refused before any request', async () => {
    const { d, reader } = deps({});
    const [g] = okGroups(
      await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('https://site.example.test/browse/OPS-7', 2), ref('not a key', 3)] }] }),
    );
    expect(summary(g)).toEqual(['L2 scheduled unmatched foreign-host', 'L3 reference/prose unmatched not-a-reference']);
    expect(reader).not.toHaveBeenCalled(); // no valid candidate, no connection
  });

  it('a link that is not a ticket link on the workspace’s own host is unmatched', async () => {
    const { d } = deps({});
    const [g] = okGroups(
      await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('https://yt.example.test/dashboard', 2)] }] }),
    );
    expect(summary(g)).toEqual(['L2 scheduled unmatched not-a-ticket-url']);
  });

  it('a legacy workspace with no backend is YouTrack', async () => {
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d, reader } = deps({ [LEGACY]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: LEGACY, candidates: [sched('READ-1', 1)] }] }));
    expect(reader).toHaveBeenCalledWith(LEGACY, 'youtrack');
    expect(summary(g)).toEqual(['L1 scheduled matched READ-1']);
  });
});

describe('runwayImportMatch — places and duplicates', () => {
  it('an earlier incidental reference never takes a later scheduled ticket’s place', async () => {
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [ref('READ-1', 1, 'nested'), ref('READ-1', 2, 'code'), sched('READ-1', 4)] }],
      }),
    );
    expect(summary(g)).toEqual(['L1 reference/nested matched READ-1', 'L2 reference/code matched READ-1', 'L4 scheduled matched READ-1']);
  });

  it('first scheduled wins by file line, whatever the order the candidates were sent in', async () => {
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('READ-1', 9), sched('READ-1', 3)] }] }),
    );
    expect(summary(g)).toEqual(['L9 scheduled duplicate READ-1 of L3', 'L3 scheduled matched READ-1']);
  });

  it.each([
    ['old key first', ['OPS-7', 'OPS-70'], ['L2 scheduled matched OPS-70', 'L3 scheduled duplicate OPS-70 of L2']],
    ['current key first', ['OPS-70', 'OPS-7'], ['L2 scheduled matched OPS-70', 'L3 scheduled duplicate OPS-70 of L2']],
  ])('a Jira issue under an old and a current key is one ticket (%s)', async (_name, [first, second], expected) => {
    // OPS-7 moved to OPS-70: the batch answers only OPS-70, and OPS-7 read on its own answers as OPS-70.
    const moved = issue('OPS-70', 'Moved');
    const r = fakeReader({ 'OPS-70': moved }, { answers: { 'OPS-7': moved } });
    const { d } = deps({ [JIRA]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: JIRA, candidates: [sched(first, 2), sched(second, 3)] }] }));
    expect(summary(g)).toEqual(expected);
    expect(g.ok && g.candidates[0].status !== 'unmatched' && g.candidates[0].ticket.issueId).toBe('jira:OPS-70');
  });

  it('a YouTrack key written in another case is the same ticket once the tracker answers', async () => {
    const t = issue('READ-1', 'Case');
    const r = fakeReader({ 'READ-1': t, 'read-1': t });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('read-1', 2), sched('READ-1', 3)] }] }));
    expect(summary(g)).toEqual(['L2 scheduled matched READ-1', 'L3 scheduled duplicate READ-1 of L2']);
  });

  it('an entity ID is not something a schedule can name', async () => {
    const { d } = deps({});
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('2-45', 2)] }] }));
    expect(summary(g)).toEqual(['L2 scheduled unmatched not-a-reference']);
  });

  it('an unmatched scheduled ticket does not take a place', async () => {
    const r = fakeReader({}, { answers: { 'READ-1': err(403, 'no access') } });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('READ-1', 2), sched('READ-1', 3)] }] }));
    expect(summary(g)).toEqual(['L2 scheduled unmatched not-readable', 'L3 scheduled unmatched not-readable']);
    expect(r.one).toHaveBeenCalledTimes(1);
  });
});

describe('runwayImportMatch — ticket states', () => {
  it('403, 404 and 410 are ticket states with messages; readable tickets still match', async () => {
    const r = fakeReader(
      { 'READ-1': issue('READ-1') },
      { answers: { 'READ-2': err(403, 'no access'), 'READ-3': err(404, 'not found'), 'READ-4': err(410, 'gone') } },
    );
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(
      await createRunwayImportMatch(d)({
        groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: ['READ-1', 'READ-2', 'READ-3', 'READ-4'].map((k, i) => sched(k, i + 1)) }],
      }),
    );
    expect(summary(g)).toEqual([
      'L1 scheduled matched READ-1',
      'L2 scheduled unmatched not-readable',
      'L3 scheduled unmatched missing-or-unreadable',
      'L4 scheduled unmatched missing',
    ]);
    if (!g.ok) throw new Error('unreachable');
    const messages = g.candidates.flatMap((c) => (c.status === 'unmatched' ? [c.message] : []));
    expect(messages[0]).toContain('no access');
    expect(messages).toHaveLength(3);
  });

  it('a matched ticket carries the stored ID, the answered key and its summary', async () => {
    const r = fakeReader({ 'OPS-7': issue('OPS-7', 'Pager') });
    const { d } = deps({ [JIRA]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: JIRA, candidates: [sched('ops-7', 1)] }] }));
    expect(g.ok && g.candidates[0]).toEqual({
      text: 'ops-7',
      line: 1,
      role: 'scheduled',
      reason: null,
      status: 'matched',
      ticket: { issueId: 'jira:OPS-7', key: 'OPS-7', summary: 'Pager' },
    });
  });
});

describe('runwayImportMatch — connection failures', () => {
  const one = (workspaceId: string) => ({ groups: [{ groupKey: 'g', workspaceId, candidates: [sched('READ-1', 1), ref('READ-2', 2)] }] });

  it('a missing credential is one group error that says what to fix, with nothing classified', async () => {
    const { d } = deps({ [YT_A]: { ok: false, code: 'credential', error: 'the shell command exited 1' } });
    const [g] = okGroups(await createRunwayImportMatch(d)(one(YT_A)));
    expect(g).toMatchObject({ ok: false, code: 'credential', retryable: false });
    expect(g.ok ? '' : g.error).toMatch(/shell command exited 1.*Settings/);
    expect('candidates' in g).toBe(false);
  });

  it('a 401 is one group error that says to correct the credential first', async () => {
    const r = fakeReader({}, { batchError: err(401, 'HTTP 401') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)(one(YT_A)));
    expect(g).toMatchObject({ ok: false, code: 'unauthorized', retryable: false });
    expect(g.ok ? '' : g.error).toMatch(/Settings/);
    expect('candidates' in g).toBe(false);
  });

  it('a 401 when the reader is opened is the same error', async () => {
    const { d } = deps({ [YT_A]: { ok: false, code: 'unauthorized', error: 'The tracker refused this workspace’s credential' } });
    const [g] = okGroups(await createRunwayImportMatch(d)(one(YT_A)));
    expect(g).toMatchObject({ ok: false, code: 'unauthorized', retryable: false });
  });

  it('a timeout is a retryable group error', async () => {
    const r = fakeReader({}, { hang: true });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } }, { timeoutMs: 5 });
    const [g] = okGroups(await createRunwayImportMatch(d)(one(YT_A)));
    expect(g).toMatchObject({ ok: false, code: 'refresh-failed', retryable: true });
    expect(g.ok ? '' : g.error).toMatch(/did not answer in time.*try again/);
    expect('candidates' in g).toBe(false);
  });

  it.each([[undefined], [503], [429]])('no answer or status %s is a retryable group error', async (status) => {
    const r = fakeReader({}, { batchError: err(status, 'unavailable') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } });
    const [g] = okGroups(await createRunwayImportMatch(d)(one(YT_A)));
    expect(g).toMatchObject({ ok: false, code: 'refresh-failed', retryable: true });
  });

  it('one group’s failure leaves another group’s result intact', async () => {
    const good = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: false, code: 'credential', error: 'missing' }, [YT_B]: { ok: true, reader: good.reader } });
    const groups = okGroups(
      await createRunwayImportMatch(d)({
        groups: [
          { groupKey: 'a', workspaceId: YT_A, candidates: [sched('READ-1', 1)] },
          { groupKey: 'b', workspaceId: YT_B, candidates: [sched('READ-1', 4)] },
        ],
      }),
    );
    expect(groups[0]).toMatchObject({ groupKey: 'a', ok: false, code: 'credential' });
    expect(summary(groups[1])).toEqual(['L4 scheduled matched READ-1']);
  });

  it('an unknown workspace fails its group and asks for another choice', async () => {
    const { d, reader } = deps({});
    const [g] = okGroups(await createRunwayImportMatch(d)(one('ws-000000000000')));
    expect(g).toMatchObject({ ok: false, code: 'unknown-workspace', retryable: false });
    expect(reader).not.toHaveBeenCalled();
  });

  it('an unreadable workspace configuration fails the whole match', async () => {
    const { d } = deps({}, { workspaces: async () => Promise.reject(new Error('disk')) });
    expect(await createRunwayImportMatch(d)(one(YT_A))).toEqual({ ok: false, code: 'workspace-unavailable', error: 'The workspace configuration could not be read: disk' });
  });
});

describe('runwayImportMatch — read-only', () => {
  it('adds no project and changes no workspace: the configuration is untouched and only reads are made', async () => {
    const before = JSON.stringify(CONFIG);
    const frozen = JSON.parse(before) as RunwayWorkspaces;
    for (const w of frozen.workspaces) Object.freeze(w);
    Object.freeze(frozen.workspaces);
    Object.freeze(frozen);
    const r = fakeReader({ 'READ-1': issue('READ-1') });
    const { d } = deps({ [YT_A]: { ok: true, reader: r.reader } }, { workspaces: async () => frozen });
    okGroups(await createRunwayImportMatch(d)({ groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [sched('READ-1', 1), sched('https://yt.example.test/projects/SYNC/issues/READ-1', 2)] }] }));
    expect(JSON.stringify(frozen)).toBe(before);
    expect(Object.keys(d).sort()).toEqual(['reader', 'trackerBaseUrl', 'workspaces']);
    expect(Object.keys(r.reader).sort()).toEqual(['admits', 'batch', 'one']);
  });
});

describe('validateImportMatchArgs', () => {
  const g = (over: Record<string, unknown> = {}, cand: Record<string, unknown> = {}) => ({
    groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [{ text: 'READ-1', line: 1, role: 'scheduled', reason: null, ...cand }], ...over }],
  });

  it('accepts a well-formed request, defaulting a missing reason for a scheduled candidate', () => {
    expect(validateImportMatchArgs(g({}, { reason: undefined }))).toEqual({
      groups: [{ groupKey: 'g', workspaceId: YT_A, candidates: [{ text: 'READ-1', line: 1, role: 'scheduled', reason: null }] }],
    });
  });

  it.each([
    ['no object', null],
    ['no groups', {}],
    ['a group without a workspace', g({ workspaceId: '' })],
    ['a non-string groupKey', g({ groupKey: 7 })],
    ['candidates not a list', g({ candidates: 'READ-1' })],
    ['a non-string text', g({}, { text: 12 })],
    ['an over-long text', g({}, { text: 'x'.repeat(2049) })],
    ['a zero line', g({}, { line: 0 })],
    ['a fractional line', g({}, { line: 1.5 })],
    ['an unknown role', g({}, { role: 'maybe' })],
    ['a scheduled candidate with a reason', g({}, { reason: 'prose' })],
    ['a reference without a reason', g({}, { role: 'reference', reason: null })],
    ['a reference with an unknown reason', g({}, { role: 'reference', reason: 'gossip' })],
    ['too many groups', { groups: Array.from({ length: 201 }, (_, i) => ({ groupKey: `g${i}`, workspaceId: YT_A, candidates: [] })) }],
  ])('refuses %s', async (_name, args) => {
    expect(typeof validateImportMatchArgs(args)).toBe('string');
    const { d, reader } = deps({});
    const workspaces = vi.spyOn(d, 'workspaces');
    expect(await createRunwayImportMatch(d)(args)).toMatchObject({ ok: false, code: 'invalid-args' });
    expect(workspaces).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it('refuses more candidates than the limit across groups', () => {
    const many = Array.from({ length: 2501 }, (_, i) => ({ text: 'READ-1', line: i + 1, role: 'scheduled', reason: null }));
    const args = { groups: [{ groupKey: 'a', workspaceId: YT_A, candidates: many }, { groupKey: 'b', workspaceId: YT_A, candidates: many }] };
    expect(validateImportMatchArgs(args)).toMatch(/At most 5000/);
  });
});

describe('scheduleCandidates', () => {
  it('lists scheduled tickets and references in file order, links as written', () => {
    const group = parseRunwaySchedule(['## A', '- [ ] https://yt.example.test/issue/READ-1 One', '  - READ-2 nested', '- [ ] READ-3, see READ-4', '```', '- READ-5', '```'].join('\n')).groups[0];
    expect(scheduleCandidates(group)).toEqual([
      sched('https://yt.example.test/issue/READ-1', 2),
      ref('READ-2', 3, 'nested'),
      sched('READ-3', 4),
      ref('READ-4', 4, 'trailing'),
      ref('READ-5', 6, 'code'),
    ]);
  });
});

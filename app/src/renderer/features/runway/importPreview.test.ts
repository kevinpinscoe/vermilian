import { describe, expect, it } from 'vitest';
import { parseRunwaySchedule } from '../../../shared/runwaySchedule';
import type { RunwayImportCandidateMatch, RunwayImportMatchArgs, RunwayImportMatchResult } from '../../../shared/runwayImport';
import { buildGroupPreview, createGroupChecker, createImportSession, proposeGroups, type GroupCheck, type GroupPreview, type ImportWorkspaceOption, type PreviewRow } from './importPreview';

// Synthetic keys, names and hosts only.
const WS: ImportWorkspaceOption[] = [
  { id: 'ws-active', name: 'Inbox' },
  { id: 'ws-reader', name: 'Reader App' },
  { id: 'ws-dup-1', name: 'Platform' },
  { id: 'ws-dup-2', name: '  platform ' },
];

const EXAMPLE = [
  '## Ship the offline reader',
  '',
  'Readers lose their place on the train. Target: before the spring release.',
  '',
  '- [ ] https://yt.example.test/issue/READ-12 - Cache articles locally',
  '- [ ] SYNC-3 - Conflict-free merge library',
  '- [ ] READ-14 - Sync read state between devices',
  '- [ ] SYNC-7 - Background sync worker',
  '- [ ] READ-20 - Offline indicator in the toolbar',
  '',
  '### Later',
  '',
  '- Look at READ-9 again; it was the first attempt and is mostly obsolete.',
].join('\n');

/** VERM-101's answer, candidate by candidate: matched unless named otherwise. */
function answer(
  candidates: { text: string; line: number; role: 'scheduled' | 'reference'; reason: RunwayImportCandidateMatch['reason'] }[],
  special: Record<number, Partial<RunwayImportCandidateMatch>> = {},
): RunwayImportCandidateMatch[] {
  return candidates.map((c) => {
    const key = /([A-Z][A-Z0-9_]*-\d+)$/.exec(c.text)?.[1] ?? c.text;
    const base = { ...c, status: 'matched' as const, ticket: { issueId: `yt:${key}`, key, summary: `Summary of ${key}` } };
    return { ...base, ...special[c.line] } as RunwayImportCandidateMatch;
  });
}

/** Each row as a short string. */
function outline(p: GroupPreview): string[] {
  return p.rows.map((r: PreviewRow) => {
    switch (r.kind) {
      case 'ticket':
        return `#${r.number} ${r.key}${r.checkbox ? ` [${r.checkbox}]` : ''}${r.titleHint ? ` ${r.titleHint}` : ''}`;
      case 'unchecked':
        return `? ${r.text}`;
      case 'unmatched':
        return `note(unmatched ${r.code}) ${r.text}`;
      case 'duplicate':
        return `note(duplicate of #${r.ofNumber}) ${r.text}`;
      case 'section':
        return `${'#'.repeat(r.depth + 3)} ${r.text}`;
      case 'note':
        return `note${r.depth ? `@${r.depth}` : ''} ${r.text.split('\n')[0]}`;
    }
  });
}

describe('proposeGroups', () => {
  it('maps a unique name match to that workspace and its own connection, after trimming and case-folding', () => {
    const [g] = proposeGroups(parseRunwaySchedule('##   reader APP  \n- READ-1'), WS, 'ws-active');
    expect(g).toMatchObject({ groupKey: 'g0', name: 'reader APP', target: { kind: 'existing', workspaceId: 'ws-reader', workspaceName: 'Reader App' }, chooseConnection: false, connectionId: 'ws-reader' });
  });

  it('marks a name that matches two workspaces ambiguous, with no connection until one is chosen', () => {
    const [g] = proposeGroups(parseRunwaySchedule('## PLATFORM\n- PLAT-1'), WS, 'ws-active');
    expect(g.target).toEqual({ kind: 'ambiguous', workspaceIds: ['ws-dup-1', 'ws-dup-2'], workspaceNames: ['Platform', '  platform '] });
    expect(g).toMatchObject({ chooseConnection: true, connectionId: null });
  });

  it('proposes a new workspace for any other name, defaulting to the active workspace’s connection', () => {
    const [g] = proposeGroups(parseRunwaySchedule(EXAMPLE), WS, 'ws-active');
    expect(g).toMatchObject({ name: 'Ship the offline reader', target: { kind: 'new' }, chooseConnection: true, connectionId: 'ws-active' });
  });

  it('maps the unnamed leading group to the active workspace', () => {
    const groups = proposeGroups(parseRunwaySchedule('- READ-1\n\n## Reader App\n- READ-2'), WS, 'ws-reader');
    expect(groups.map((g) => [g.groupKey, g.name, g.target.kind, g.connectionId, g.chooseConnection])).toEqual([
      ['g0', null, 'active', 'ws-reader', false],
      ['g1', 'Reader App', 'existing', 'ws-reader', false],
    ]);
  });

  it('an unknown active ID falls back to no workspace: new and unnamed groups wait for a choice', () => {
    const groups = proposeGroups(parseRunwaySchedule('- READ-0\n\n## New one\n- READ-1'), WS, 'ws-gone');
    expect(groups.map((g) => [g.target.kind, g.chooseConnection, g.connectionId])).toEqual([
      ['unassigned', true, null],
      ['new', true, null],
    ]);
  });

  it('carries the group’s candidates as written, in file order', () => {
    const [g] = proposeGroups(parseRunwaySchedule(EXAMPLE), WS, 'ws-active');
    expect(g.candidates.map((c) => [c.line, c.role, c.text])).toEqual([
      [5, 'scheduled', 'https://yt.example.test/issue/READ-12'],
      [6, 'scheduled', 'SYNC-3'],
      [7, 'scheduled', 'READ-14'],
      [8, 'scheduled', 'SYNC-7'],
      [9, 'scheduled', 'READ-20'],
      [13, 'reference', 'READ-9'],
    ]);
  });
});

describe('buildGroupPreview', () => {
  const one = (md: string) => proposeGroups(parseRunwaySchedule(md), WS, 'ws-active')[0];

  it('the section 5 example: #1..5 in file order, the paragraph, the section and its note, READ-9 an unticked reference', () => {
    const g = one(EXAMPLE);
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates));
    expect(outline(p)).toEqual([
      'note Readers lose their place on the train. Target: before the spring release.',
      '#1 READ-12 [ ] Cache articles locally',
      '#2 SYNC-3 [ ] Conflict-free merge library',
      '#3 READ-14 [ ] Sync read state between devices',
      '#4 SYNC-7 [ ] Background sync worker',
      '#5 READ-20 [ ] Offline indicator in the toolbar',
      '### Later',
      'note - Look at READ-9 again; it was the first attempt and is mostly obsolete.',
    ]);
    expect(p.scheduledCount).toBe(5);
    expect(p.references).toEqual([{ text: 'READ-9', line: 13, reason: 'prose', cue: null, status: 'matched', key: 'READ-9', summary: 'Summary of READ-9' }]);
  });

  it('before the result arrives, or after the connection failed, the outline stays with tickets unchecked and unnumbered', () => {
    const g = one(EXAMPLE);
    const p = buildGroupPreview(g.group, g.candidates, null);
    expect(outline(p)).toEqual([
      'note Readers lose their place on the train. Target: before the spring release.',
      '? https://yt.example.test/issue/READ-12',
      '? SYNC-3',
      '? READ-14',
      '? SYNC-7',
      '? READ-20',
      '### Later',
      'note - Look at READ-9 again; it was the first attempt and is mostly obsolete.',
    ]);
    expect(p.scheduledCount).toBe(0);
    expect(p.references.map((r) => r.status)).toEqual(['unchecked']);
  });

  it('numbers only matched scheduled tickets; an individually unmatched one becomes a note with its reason', () => {
    const g = one('- [x] READ-1 Done one\n- [ ] OPS-2 Other tracker\n- [-] READ-3 Dropped\n- READ-4');
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates, { 2: { status: 'unmatched', code: 'not-a-reference', message: 'That is not a YouTrack ticket key.' } }));
    expect(outline(p)).toEqual(['#1 READ-1 [x] Done one', 'note(unmatched not-a-reference) OPS-2', '#2 READ-3 [-] Dropped', '#3 READ-4']);
    expect(p.rows[1]).toMatchObject({ kind: 'unmatched', message: 'That is not a YouTrack ticket key.', titleHint: 'Other tracker', checkbox: ' ' });
  });

  it('a confirmed duplicate stays a note in place and is listed as Already scheduled as #N', () => {
    // READ-1 and its old key OLD-1 are one ticket: the matcher says line 3 duplicates line 2.
    const g = one('- READ-5\n- READ-1 First\n- OLD-1 Again');
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates, { 3: { status: 'duplicate', duplicateOfLine: 2, ticket: { issueId: 'yt:READ-1', key: 'READ-1', summary: 'S' } } as Partial<RunwayImportCandidateMatch> }));
    expect(outline(p)).toEqual(['#1 READ-5', '#2 READ-1 First', 'note(duplicate of #2) OLD-1']);
    expect(p.references).toEqual([{ text: 'OLD-1', line: 3, reason: 'duplicate', cue: null, status: 'duplicate', key: 'READ-1', ofNumber: 2 }]);
  });

  it('a parser duplicate the matcher accepts (the earlier link was refused) is numbered there, exactly once', () => {
    const g = one(['- [x] https://tracker.example.test/other/issue/OPS-7 First', '- [ ] https://tracker.example.test/youtrack/issue/OPS-7 Second'].join('\n'));
    expect(g.candidates.map((c) => c.role)).toEqual(['scheduled', 'scheduled']);
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates, { 1: { status: 'unmatched', code: 'not-a-ticket-url', message: 'That link does not point at a YouTrack ticket.' } }));
    expect(outline(p)).toEqual(['note(unmatched not-a-ticket-url) https://tracker.example.test/other/issue/OPS-7', '#1 OPS-7 [ ] Second']);
    expect(p.rows.filter((r) => r.kind === 'ticket')).toHaveLength(1);
    expect(p.references).toEqual([]);
  });

  it('two identical valid scheduled lines: the second is a note listed as Already scheduled as #1', () => {
    const g = one('- OPS-7 One\n- OPS-7 Two');
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates, { 2: { status: 'duplicate', duplicateOfLine: 1 } as Partial<RunwayImportCandidateMatch> }));
    expect(outline(p)).toEqual(['#1 OPS-7 One', 'note(duplicate of #1) OPS-7']);
    expect(p.rows[1]).toMatchObject({ titleHint: 'Two' });
    expect(p.references).toEqual([{ text: 'OPS-7', line: 2, reason: 'duplicate', cue: null, status: 'duplicate', key: 'OPS-7', ofNumber: 1 }]);
  });

  it('a pending parser duplicate stays the parser’s note until the matcher decides', () => {
    const g = one('- OPS-7 One\n- OPS-7 Two');
    expect(outline(buildGroupPreview(g.group, g.candidates, null))).toEqual(['? OPS-7', 'note - OPS-7 Two']);
  });

  it('references keep their line, reason, cue and match result, read-only', () => {
    const g = one(['- [ ] READ-1 Fix, see READ-2', '  - READ-3 nested', '', '| READ-4 |', '| --- |', '', '```', '- READ-5', '```', '', 'Moved to OPS-6.'].join('\n'));
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates, { 11: { status: 'unmatched', code: 'not-a-reference', message: 'Not a YouTrack key.' } }));
    expect(p.references.map((r) => [r.line, r.text, r.reason, r.cue, r.status])).toEqual([
      [1, 'READ-2', 'trailing', 'see', 'matched'],
      [2, 'READ-3', 'nested', null, 'matched'],
      [4, 'READ-4', 'table', null, 'matched'],
      [8, 'READ-5', 'code', null, 'matched'],
      [11, 'OPS-6', 'prose', 'moved to', 'unmatched'],
    ]);
  });

  it('section depth and indented notes are kept', () => {
    const g = one('### Phase\n#### Detail\n- READ-1\n  continued text');
    const p = buildGroupPreview(g.group, g.candidates, answer(g.candidates));
    expect(p.rows.map((r) => ('depth' in r ? [r.kind, r.depth] : [r.kind]))).toEqual([['section', 0], ['section', 1], ['ticket'], ['note', 1]]);
  });

  it('a result of the wrong length is treated as unchecked rather than misaligned', () => {
    const g = one('- READ-1\n- READ-2');
    expect(buildGroupPreview(g.group, g.candidates, answer(g.candidates).slice(0, 1)).scheduledCount).toBe(0);
  });
});

describe('createGroupChecker', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const ok = (groupKey: string, workspaceId: string, key: string): RunwayImportMatchResult => ({
    ok: true,
    groups: [{ groupKey, workspaceId, ok: true, candidates: [{ text: key, line: 2, role: 'scheduled', reason: null, status: 'matched', ticket: { issueId: `yt:${key}`, key, summary: workspaceId } }] }],
  });

  it('a slow first lookup that returns after its replacement is dropped: the current connection’s result stays', async () => {
    const [g] = proposeGroups(parseRunwaySchedule('## New one\n- READ-1'), WS, 'ws-active');
    const calls: { args: RunwayImportMatchArgs; d: ReturnType<typeof deferred<RunwayImportMatchResult>> }[] = [];
    const reports: GroupCheck[] = [];
    const checker = createGroupChecker(
      (args) => {
        const d = deferred<RunwayImportMatchResult>();
        calls.push({ args, d });
        return d.promise;
      },
      (_key, check) => reports.push(check),
    );

    checker.check(g, 'ws-active'); // slow
    checker.check(g, 'ws-reader'); // the replacement
    expect(calls.map((c) => c.args.groups[0].workspaceId)).toEqual(['ws-active', 'ws-reader']);

    calls[1].d.resolve(ok('g0', 'ws-reader', 'READ-1'));
    await calls[1].d.promise;
    await Promise.resolve();
    calls[0].d.resolve(ok('g0', 'ws-active', 'READ-1'));
    await calls[0].d.promise;
    await Promise.resolve();

    const last = reports[reports.length - 1];
    expect(last).toMatchObject({ state: 'done', connectionId: 'ws-reader', match: { workspaceId: 'ws-reader' } });
    expect(reports.filter((r) => r.state === 'done').map((r) => r.connectionId)).toEqual(['ws-reader']);
  });

  it('rechecks only the group whose connection changed', () => {
    const groups = proposeGroups(parseRunwaySchedule('## A\n- READ-1\n## B\n- READ-2'), WS, 'ws-active');
    const sent: string[] = [];
    const checker = createGroupChecker(
      (args) => {
        sent.push(`${args.groups[0].groupKey}@${args.groups[0].workspaceId}`);
        return new Promise(() => undefined);
      },
      () => undefined,
    );
    groups.forEach((g) => checker.check(g, g.connectionId as string));
    checker.check(groups[1], 'ws-reader');
    expect(sent).toEqual(['g0@ws-active', 'g1@ws-active', 'g1@ws-reader']);
  });

  it('a group with no tickets is done at once, with no request', () => {
    const [g] = proposeGroups(parseRunwaySchedule('## Notes only\nJust prose.'), WS, 'ws-active');
    const reports: GroupCheck[] = [];
    let calls = 0;
    createGroupChecker(async () => {
      calls += 1;
      return { ok: true, groups: [] };
    }, (_k, c) => reports.push(c)).check(g, 'ws-active');
    expect(calls).toBe(0);
    expect(reports).toEqual([{ state: 'done', connectionId: 'ws-active', match: { groupKey: 'g0', workspaceId: 'ws-active', ok: true, candidates: [] } }]);
  });

  it('a rejected call is a retryable failure; nothing is reported after dispose', async () => {
    const [g] = proposeGroups(parseRunwaySchedule('## A\n- READ-1'), WS, 'ws-active');
    const reports: GroupCheck[] = [];
    const checker = createGroupChecker(() => Promise.reject(new Error('IPC gone')), (_k, c) => reports.push(c));
    checker.check(g, 'ws-active');
    await new Promise((r) => setTimeout(r, 0));
    expect(reports[reports.length - 1]).toEqual({ state: 'failed', connectionId: 'ws-active', error: 'IPC gone', retryable: true });

    const d = deferred<RunwayImportMatchResult>();
    const later: GroupCheck[] = [];
    const c2 = createGroupChecker(() => d.promise, (_k, c) => later.push(c));
    c2.check(g, 'ws-active');
    c2.dispose();
    d.resolve(ok('g0', 'ws-active', 'READ-1'));
    await d.promise;
    await Promise.resolve();
    expect(later.map((r) => r.state)).toEqual(['pending']);
  });
});

describe('createImportSession', () => {
  type Call = RunwayImportMatchArgs['groups'][number];
  function harness(md: string, activeId: string) {
    const calls: Call[] = [];
    const session = createImportSession(
      parseRunwaySchedule(md),
      activeId,
      async (args) => {
        calls.push(...args.groups);
        return { ok: true, groups: args.groups.map((g) => ({ groupKey: g.groupKey, workspaceId: g.workspaceId, ok: true as const, candidates: [] })) };
      },
      () => undefined,
    );
    return { calls, session };
  }

  it('two workspaces match the heading and a third is active: no lookup until one is chosen, then one on the chosen workspace', () => {
    const { calls, session } = harness('## Platform\n- PLAT-1\n- PLAT-2', 'ws-active');
    session.setWorkspaces({ state: 'ready', workspaces: WS });
    expect(session.state().groups?.[0].target.kind).toBe('ambiguous');
    expect(session.state().connections).toEqual({ g0: null });
    expect(calls).toEqual([]);

    session.choose('g0', 'ws-dup-2');
    expect(calls.map((c) => [c.groupKey, c.workspaceId])).toEqual([['g0', 'ws-dup-2']]);
    expect(calls.some((c) => c.workspaceId === 'ws-active')).toBe(false);
  });

  it('A active and a file headed ## B while the workspace list is delayed: A gets no lookup; B is recognised and checked when the list arrives', () => {
    const A = { id: 'ws-a', name: 'A' };
    const B = { id: 'ws-b', name: 'B' };
    const { calls, session } = harness('## B\n- READ-1', 'ws-a');
    expect(session.state().workspaces).toEqual({ state: 'loading' });
    expect(session.state().groups).toBeNull();
    expect(calls).toEqual([]);

    session.setWorkspaces({ state: 'ready', workspaces: [A, B] });
    expect(session.state().groups?.[0].target).toEqual({ kind: 'existing', workspaceId: 'ws-b', workspaceName: 'B' });
    expect(calls.map((c) => c.workspaceId)).toEqual(['ws-b']);
  });

  it('a failed workspace read maps nothing and checks nothing until a retry succeeds', () => {
    const { calls, session } = harness('## B\n- READ-1', 'ws-a');
    session.setWorkspaces({ state: 'failed', error: 'The workspace configuration could not be read.' });
    expect(session.state().workspaces).toEqual({ state: 'failed', error: 'The workspace configuration could not be read.' });
    expect(session.state().groups).toBeNull();
    expect(calls).toEqual([]);

    session.setWorkspaces({ state: 'loading' });
    session.setWorkspaces({ state: 'ready', workspaces: [{ id: 'ws-a', name: 'A' }, { id: 'ws-b', name: 'B' }] });
    expect(calls.map((c) => c.workspaceId)).toEqual(['ws-b']);
  });

  it('the first list read is kept: a later refetch neither remaps nor rechecks', () => {
    const { calls, session } = harness('## New one\n- READ-1', 'ws-active');
    session.setWorkspaces({ state: 'ready', workspaces: WS });
    session.setWorkspaces({ state: 'ready', workspaces: [...WS, { id: 'ws-new', name: 'New one' }] });
    expect(session.state().groups?.[0].target.kind).toBe('new');
    expect(calls.map((c) => c.workspaceId)).toEqual(['ws-active']);
  });

  it('choosing and retrying check that group only; nothing is checked after dispose', () => {
    const { calls, session } = harness('## One\n- READ-1\n## Two\n- READ-2', 'ws-active');
    session.setWorkspaces({ state: 'ready', workspaces: WS });
    session.choose('g1', 'ws-reader');
    session.retry('g1');
    expect(calls.map((c) => `${c.groupKey}@${c.workspaceId}`)).toEqual(['g0@ws-active', 'g1@ws-active', 'g1@ws-reader', 'g1@ws-reader']);
    session.dispose();
    session.choose('g0', 'ws-reader');
    expect(calls).toHaveLength(4);
  });
});

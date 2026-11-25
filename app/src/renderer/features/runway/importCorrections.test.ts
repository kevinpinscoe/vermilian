import { describe, expect, it } from 'vitest';
import { parseRunwaySchedule } from '../../../shared/runwaySchedule';
import type { RunwayImportCandidateMatch, RunwayImportMatchArgs, RunwayImportMatchResult } from '../../../shared/runwayImport';
import { createImportSession, groupPreview, nameCollisions, nameProblem, type ImportSession, type WorkingGroup } from './importCorrections';
import type { ImportWorkspaceOption, PreviewRow } from './importPreview';

// Synthetic keys, names and hosts only.
const WS: ImportWorkspaceOption[] = [
  { id: 'ws-active', name: 'Inbox' },
  { id: 'ws-reader', name: 'Reader App' },
  { id: 'ws-p1', name: 'Platform' },
  { id: 'ws-p2', name: 'platform' },
];

const FILE = [
  '## Reader', // 1
  '- READ-1 One', // 2
  '- READ-2 Two', // 3
  '### Later', // 4
  '- READ-3 Three', // 5
  '#### Deep', // 6
  '- READ-4 Four, see READ-9', // 7
  '### After', // 8
  '- READ-5 Five', // 9
  '', // 10
  '## Sync', // 11
  '- SYNC-1 First, see READ-1', // 12
  '', // 13
  'Mentions READ-7 and OLD-2 in prose.', // 14
].join('\n');

const keyOf = (text: string) => /([A-Z][A-Z0-9_]*-\d+)$/.exec(text)?.[1] ?? text;

/**
 * A fake VERM-101: every key matches under its own ID, except OLD-n, a moved
 * issue answering as READ-n, and GONE-n, which is missing. The first scheduled
 * occurrence of a ticket, by the line sent, keeps its place.
 */
function fakeMatch(args: RunwayImportMatchArgs): RunwayImportMatchResult {
  return {
    ok: true,
    groups: args.groups.map((g) => {
      const first = new Map<string, number>();
      const order = g.candidates.map((c, i) => ({ c, i })).sort((a, b) => a.c.line - b.c.line || a.i - b.i);
      const out: RunwayImportCandidateMatch[] = g.candidates.map((c) => {
        const asked = keyOf(c.text);
        if (asked.startsWith('GONE-')) return { ...c, status: 'unmatched', code: 'missing', message: 'Ticket missing.' };
        const key = asked.startsWith('OLD-') ? asked.replace('OLD-', 'READ-') : asked;
        return { ...c, status: 'matched', ticket: { issueId: `yt:${key}`, key, summary: `${key} on ${g.workspaceId}` } };
      });
      for (const { c, i } of order) {
        const r = out[i];
        if (c.role !== 'scheduled' || r.status !== 'matched') continue;
        const earlier = first.get(r.ticket.issueId);
        if (earlier !== undefined) out[i] = { ...r, status: 'duplicate', duplicateOfLine: earlier };
        else first.set(r.ticket.issueId, c.line);
      }
      return { groupKey: g.groupKey, workspaceId: g.workspaceId, ok: true as const, candidates: out };
    }),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A session whose lookups answer at once (or are held when `hold` is set). */
function open(md: string, activeId = 'ws-active', opts: { hold?: boolean } = {}) {
  const calls: { groupKey: string; workspaceId: string; texts: string[] }[] = [];
  const held: { args: RunwayImportMatchArgs; d: ReturnType<typeof deferred<RunwayImportMatchResult>> }[] = [];
  const session = createImportSession(
    parseRunwaySchedule(md),
    activeId,
    (args) => {
      for (const g of args.groups) calls.push({ groupKey: g.groupKey, workspaceId: g.workspaceId, texts: g.candidates.map((c) => c.text) });
      if (opts.hold) {
        const d = deferred<RunwayImportMatchResult>();
        held.push({ args, d });
        return d.promise;
      }
      return Promise.resolve(fakeMatch(args));
    },
    () => undefined,
  );
  session.setWorkspaces({ state: 'ready', workspaces: WS });
  return { session, calls, held };
}

const groups = (s: ImportSession): WorkingGroup[] => s.state().groups ?? [];
const group = (s: ImportSession, key: string): WorkingGroup => {
  const g = groups(s).find((x) => x.groupKey === key);
  if (!g) throw new Error(`no group ${key}`);
  return g;
};
const results = (s: ImportSession, key: string) => {
  const c = s.state().checks[key];
  return c?.state === 'done' && c.match.ok ? c.match.candidates : null;
};
const preview = (s: ImportSession, key: string) => groupPreview(group(s, key), results(s, key));

/** Each row as a short string, with its file line. */
function outline(rows: PreviewRow[]): string[] {
  return rows.map((r) => {
    switch (r.kind) {
      case 'ticket':
        return `L${r.line} #${r.number} ${r.key}${r.refId ? ' (ticked)' : ''}`;
      case 'unchecked':
        return `L${r.line} ? ${r.text}`;
      case 'unmatched':
        return `L${r.line} note(unmatched) ${r.text}`;
      case 'duplicate':
        return `L${r.line} note(duplicate of #${r.ofNumber}) ${r.text}`;
      case 'section':
        return `L${r.line} ${'#'.repeat(r.depth + 3)} ${r.text}${r.join ? ' (join)' : ''}`;
      case 'note':
        return `L${r.line} note ${r.text.split('\n')[0]}`;
    }
  });
}

const refId = (s: ImportSession, key: string, text: string) => {
  const r = preview(s, key).references.find((x) => x.text === text);
  if (!r?.id) throw new Error(`no reference ${text}`);
  return r.id;
};

describe('rename', () => {
  it('renames a proposed new workspace; a collision is only reported, never acted on', async () => {
    const { session, calls } = open(FILE);
    await flush();
    const before = calls.length;
    expect(session.apply({ op: 'rename', groupKey: 'g0', name: '  Reader app  ' })).toBe(true);
    expect(group(session, 'g0')).toMatchObject({ name: 'Reader app', target: { kind: 'new' } });
    expect(nameCollisions(group(session, 'g0'), groups(session), WS).workspaces.map((w) => w.id)).toEqual(['ws-reader']);

    session.apply({ op: 'rename', groupKey: 'g1', name: 'reader APP' });
    expect(nameCollisions(group(session, 'g1'), groups(session), WS).groups.map((g) => g.groupKey)).toEqual(['g0']);
    expect(group(session, 'g1').target.kind).toBe('new');
    expect(calls.length).toBe(before); // a rename sends nothing
  });

  it('an existing workspace’s name is read-only until New workspace is selected', () => {
    const { session } = open('## Reader App\n- READ-1');
    expect(group(session, 'g0').target.kind).toBe('existing');
    expect(session.apply({ op: 'rename', groupKey: 'g0', name: 'Other' })).toBe(false);
    session.apply({ op: 'map', groupKey: 'g0', workspaceId: null });
    expect(session.apply({ op: 'rename', groupKey: 'g0', name: 'Other' })).toBe(true);
    expect(group(session, 'g0').name).toBe('Other');
  });

  it('a blank or over-long name is refused', () => {
    expect(nameProblem('   ')).toBe('A workspace needs a name.');
    expect(nameProblem('x'.repeat(201))).toMatch(/at most 200/);
    expect(nameProblem('x'.repeat(200))).toBeNull();
    const { session } = open(FILE);
    expect(session.apply({ op: 'rename', groupKey: 'g0', name: ' ' })).toBe(false);
    expect(session.state().corrections).toEqual([]);
  });
});

describe('map', () => {
  it('mapping to an existing workspace checks the group on that workspace’s connection; New workspace restores the active default', async () => {
    const { session, calls } = open(FILE);
    await flush();
    calls.length = 0;
    session.apply({ op: 'map', groupKey: 'g1', workspaceId: 'ws-reader' });
    expect(group(session, 'g1')).toMatchObject({ target: { kind: 'existing', workspaceId: 'ws-reader' }, chooseConnection: false, connectionId: 'ws-reader' });
    expect(calls.map((c) => `${c.groupKey}@${c.workspaceId}`)).toEqual(['g1@ws-reader']);

    session.apply({ op: 'map', groupKey: 'g1', workspaceId: null });
    expect(group(session, 'g1')).toMatchObject({ target: { kind: 'new' }, chooseConnection: true, connectionId: 'ws-active' });
    await flush();
    expect(calls.length).toBe(1); // the active connection's answer is still known
  });

  it('an ambiguous heading waits; mapping it to one of the matches checks it there', async () => {
    const { session, calls } = open('## PLATFORM\n- PLAT-1');
    expect(group(session, 'g0').target.kind).toBe('ambiguous');
    expect(calls).toEqual([]);
    session.apply({ op: 'map', groupKey: 'g0', workspaceId: 'ws-p2' });
    expect(calls.map((c) => c.workspaceId)).toEqual(['ws-p2']);
  });

  it('the unnamed group can be mapped to another workspace but has no New workspace', () => {
    const { session } = open('- READ-1\n\n## Reader\n- READ-2');
    expect(group(session, 'g0').target.kind).toBe('active');
    expect(session.apply({ op: 'map', groupKey: 'g0', workspaceId: null })).toBe(false);
    expect(session.apply({ op: 'map', groupKey: 'g0', workspaceId: 'ws-reader' })).toBe(true);
  });
});

describe('merge', () => {
  it('appends the source with its heading kept as a section at the join; the target keeps its connection; file lines are kept', async () => {
    const { session, calls } = open(FILE);
    session.apply({ op: 'map', groupKey: 'g0', workspaceId: 'ws-reader' });
    await flush();
    calls.length = 0;
    session.apply({ op: 'merge', source: 'g1', target: 'g0' });
    await flush();
    expect(groups(session).map((g) => g.groupKey)).toEqual(['g0']);
    expect(group(session, 'g0').connectionId).toBe('ws-reader');
    expect(calls.map((c) => `${c.groupKey}@${c.workspaceId}`)).toEqual(['g0@ws-reader']);
    expect(outline(preview(session, 'g0').rows)).toEqual([
      'L2 #1 READ-1',
      'L3 #2 READ-2',
      'L4 ### Later',
      'L5 #3 READ-3',
      'L6 #### Deep',
      'L7 #4 READ-4',
      'L8 ### After',
      'L9 #5 READ-5',
      'L11 ### Sync (join)',
      'L12 #6 SYNC-1',
      'L14 note Mentions READ-7 and OLD-2 in prose.',
    ]);
  });

  it('preview order decides which occurrence is numbered, even when the source came first in the file', async () => {
    const { session } = open(['## First', '- READ-1 early', '', '## Second', '- READ-1 late', '- READ-2'].join('\n'));
    session.apply({ op: 'merge', source: 'g0', target: 'g1' });
    await flush();
    expect(outline(preview(session, 'g1').rows)).toEqual(['L5 #1 READ-1', 'L6 #2 READ-2', 'L1 ### First (join)', 'L2 note(duplicate of #1) READ-1']);
    expect(preview(session, 'g1').references).toMatchObject([{ status: 'duplicate', line: 2, ofNumber: 1 }]);
  });

  it('a skipped group cannot be merged, or merged into', () => {
    const { session } = open(FILE);
    session.apply({ op: 'skip', groupKey: 'g1', skipped: true });
    expect(session.apply({ op: 'merge', source: 'g1', target: 'g0' })).toBe(false);
    expect(session.apply({ op: 'merge', source: 'g0', target: 'g1' })).toBe(false);
  });
});

describe('split', () => {
  it('a top-level ### becomes a new group right after its parent, with its rows and References; deeper headings move up; the parent’s connection is kept', async () => {
    const { session, calls } = open(FILE);
    session.apply({ op: 'connection', groupKey: 'g0', workspaceId: 'ws-reader' });
    await flush();
    calls.length = 0;
    expect(session.apply({ op: 'split', groupKey: 'g0', segment: 0, line: 4 })).toBe(true);
    await flush();
    expect(groups(session).map((g) => [g.groupKey, g.name, g.target.kind, g.connectionId])).toEqual([
      ['g0', 'Reader', 'new', 'ws-reader'],
      ['g0>4', 'Later', 'new', 'ws-reader'],
      ['g1', 'Sync', 'new', 'ws-active'],
    ]);
    expect(outline(preview(session, 'g0').rows)).toEqual(['L2 #1 READ-1', 'L3 #2 READ-2', 'L8 ### After', 'L9 #3 READ-5']);
    expect(outline(preview(session, 'g0>4').rows)).toEqual(['L5 #1 READ-3', 'L6 ### Deep', 'L7 #2 READ-4']);
    expect(preview(session, 'g0>4').references.map((r) => [r.line, r.text])).toEqual([[7, 'READ-9']]);
    expect(preview(session, 'g0').references).toEqual([]);
    expect(calls.map((c) => c.groupKey).sort()).toEqual(['g0', 'g0>4']);
  });

  it('a group waiting for a connection splits into one that waits too', () => {
    const { session, calls } = open(['## PLATFORM', '- PLAT-1', '### Later', '- PLAT-2'].join('\n'));
    session.apply({ op: 'split', groupKey: 'g0', segment: 0, line: 3 });
    expect(groups(session).map((g) => g.connectionId)).toEqual([null, null]);
    expect(calls).toEqual([]);
  });

  it('only a top-level ### from the file splits: not a deeper heading, not a merge join', async () => {
    const { session } = open(FILE);
    expect(session.apply({ op: 'split', groupKey: 'g0', segment: 0, line: 6 })).toBe(false);
    session.apply({ op: 'merge', source: 'g1', target: 'g0' });
    await flush();
    const join = preview(session, 'g0').rows.find((r) => r.kind === 'section' && r.join);
    expect(join).toMatchObject({ splittable: false, segment: 1 });
    expect(session.apply({ op: 'split', groupKey: 'g0', segment: 1, line: 11 })).toBe(false);
  });
});

describe('skip', () => {
  it('collapses the group and keeps its edits for Include again; skipping sends nothing', async () => {
    const { session, calls } = open(FILE);
    session.apply({ op: 'rename', groupKey: 'g0', name: 'Renamed' });
    await flush();
    const before = calls.length;
    session.apply({ op: 'skip', groupKey: 'g0', skipped: true });
    expect(group(session, 'g0')).toMatchObject({ skipped: true, name: 'Renamed' });
    session.apply({ op: 'skip', groupKey: 'g0', skipped: false });
    expect(group(session, 'g0')).toMatchObject({ skipped: false, name: 'Renamed' });
    expect(calls.length).toBe(before);
  });

  it('a lookup in flight when the group is skipped never fills it later; Include again checks afresh', async () => {
    const { session, calls, held } = open('## New one\n- READ-1', 'ws-active', { hold: true });
    expect(held).toHaveLength(1);
    session.apply({ op: 'skip', groupKey: 'g0', skipped: true });
    held[0].d.resolve(fakeMatch(held[0].args));
    await flush();
    expect(session.state().checks.g0).toBeUndefined();

    session.apply({ op: 'skip', groupKey: 'g0', skipped: false });
    expect(calls).toHaveLength(2);
    expect(session.state().checks.g0).toMatchObject({ state: 'pending' });
  });
});

describe('tick and untick', () => {
  it('a matched Reference is scheduled at its source position, after a scheduled ticket on the same line; untick reverses it', async () => {
    const { session, calls } = open(FILE);
    await flush();
    const before = calls.length;
    const id = refId(session, 'g0', 'READ-9');
    session.apply({ op: 'tick', groupKey: 'g0', refId: id, ticked: true });
    expect(outline(preview(session, 'g0').rows).slice(4, 8)).toEqual(['L6 #### Deep', 'L7 #4 READ-4', 'L7 #5 READ-9 (ticked)', 'L8 ### After']);
    expect(preview(session, 'g0').rows.filter((r) => r.kind === 'ticket').map((r) => (r.kind === 'ticket' ? r.number : 0))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(preview(session, 'g0').references).toMatchObject([{ text: 'READ-9', ticked: true, tickable: true, scheduledAs: 5 }]);

    session.apply({ op: 'tick', groupKey: 'g0', refId: id, ticked: false });
    expect(outline(preview(session, 'g0').rows)).not.toContain('L7 #5 READ-9 (ticked)');
    expect(preview(session, 'g0').scheduledCount).toBe(5);
    expect(calls.length).toBe(before); // ticking sends nothing
  });

  it('another mention of a scheduled ticket, or a moved issue’s old key, cannot add a second copy', async () => {
    const { session } = open(FILE);
    session.apply({ op: 'merge', source: 'g1', target: 'g0' });
    await flush();
    // READ-1 is scheduled at #1; the merged group also mentions it after "see" on line 12.
    const seeRead1 = preview(session, 'g0').references.find((r) => r.text === 'READ-1' && r.line === 12);
    expect(seeRead1).toMatchObject({ tickable: false, alreadyAs: 1 });
    session.apply({ op: 'tick', groupKey: 'g0', refId: seeRead1?.id as string, ticked: true });
    expect(preview(session, 'g0').rows.filter((r) => r.kind === 'ticket' && r.key === 'READ-1')).toHaveLength(1);

    // OLD-2 answers as READ-2, which is scheduled at #2.
    expect(preview(session, 'g0').references.find((r) => r.text === 'OLD-2')).toMatchObject({ tickable: false, alreadyAs: 2 });
  });

  it('two mentions of one unscheduled ticket: ticking the first leaves the second un-tickable', async () => {
    const { session } = open(['## G', '- READ-1', '', 'See READ-8.', '', 'Again READ-8.'].join('\n'));
    await flush();
    const [first, second] = preview(session, 'g0').references;
    session.apply({ op: 'tick', groupKey: 'g0', refId: first.id as string, ticked: true });
    expect(preview(session, 'g0').references).toMatchObject([
      { line: 4, ticked: true, scheduledAs: 2 },
      { line: 6, ticked: false, tickable: false, alreadyAs: 2 },
    ]);
    expect(second.id).not.toBe(first.id);
  });

  it('an unmatched Reference cannot be numbered', async () => {
    const { session } = open(['## G', '- READ-1', '', 'See GONE-3.'].join('\n'));
    await flush();
    const ref = preview(session, 'g0').references[0];
    expect(ref).toMatchObject({ status: 'unmatched', tickable: false });
  });

  it('after a connection change a ticked Reference is numbered only once the new connection confirms it', async () => {
    const { session, held } = open(['## New one', '- READ-1', '', 'See READ-8.'].join('\n'), 'ws-active', { hold: true });
    held[0].d.resolve(fakeMatch(held[0].args));
    await flush();
    session.apply({ op: 'tick', groupKey: 'g0', refId: refId(session, 'g0', 'READ-8'), ticked: true });
    expect(preview(session, 'g0').scheduledCount).toBe(2);

    session.apply({ op: 'connection', groupKey: 'g0', workspaceId: 'ws-reader' });
    expect(preview(session, 'g0').scheduledCount).toBe(0);
    expect(outline(preview(session, 'g0').rows)).toEqual(['L2 ? READ-1', 'L4 note See READ-8.']);
    held[1].d.resolve(fakeMatch(held[1].args));
    await flush();
    expect(outline(preview(session, 'g0').rows)).toEqual(['L2 #1 READ-1', 'L4 note See READ-8.', 'L4 #2 READ-8 (ticked)']);
  });

  it('ticks move with a split and merge along with their group', async () => {
    const { session } = open(FILE);
    await flush();
    session.apply({ op: 'tick', groupKey: 'g0', refId: refId(session, 'g0', 'READ-9'), ticked: true });
    session.apply({ op: 'split', groupKey: 'g0', segment: 0, line: 4 });
    await flush();
    expect(group(session, 'g0').ticked).toEqual([]);
    expect(outline(preview(session, 'g0>4').rows)).toContain('L7 #3 READ-9 (ticked)');
    session.apply({ op: 'merge', source: 'g0>4', target: 'g1' });
    await flush();
    expect(outline(preview(session, 'g1').rows)).toContain('L7 #4 READ-9 (ticked)');
  });
});

describe('undo and reset', () => {
  it('Undo reverses the last edit; Reset restores the preview as first opened, reusing known answers', async () => {
    const { session, calls } = open(FILE);
    await flush();
    const first = JSON.stringify(groups(session));
    const before = calls.length;
    session.apply({ op: 'rename', groupKey: 'g0', name: 'X' });
    session.apply({ op: 'merge', source: 'g1', target: 'g0' });
    await flush();
    session.apply({ op: 'tick', groupKey: 'g0', refId: refId(session, 'g0', 'READ-9'), ticked: true });

    session.undo();
    expect(group(session, 'g0').ticked).toEqual([]);
    expect(groups(session)).toHaveLength(1);
    session.undo();
    expect(groups(session).map((g) => g.groupKey)).toEqual(['g0', 'g1']);
    expect(group(session, 'g0').name).toBe('X');

    session.apply({ op: 'skip', groupKey: 'g1', skipped: true });
    session.reset();
    expect(session.state().corrections).toEqual([]);
    expect(JSON.stringify(groups(session))).toBe(first);
    await flush();
    // Only the merged group needed a lookup; undo and reset reused the earlier answers.
    expect(calls.length).toBe(before + 1);
  });
});

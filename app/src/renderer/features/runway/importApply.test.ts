import { describe, expect, it } from 'vitest';
import { parseRunwaySchedule } from '../../../shared/runwaySchedule';
import type { RunwayImportCandidateMatch, RunwayImportMatchArgs, RunwayImportMatchResult } from '../../../shared/runwayImport';
import { createImportSession, type ImportSession } from './importCorrections';
import { appliedSummary, applyBlockers, applyPlan, canApply } from './importApply';
import type { ImportWorkspaceOption } from './importPreview';

// Synthetic keys, names and hosts only.
const WS: ImportWorkspaceOption[] = [
  { id: 'ws-active', name: 'Inbox' },
  { id: 'ws-reader', name: 'Reader App' },
  { id: 'ws-p1', name: 'Platform' },
  { id: 'ws-p2', name: 'platform' },
];

const EXAMPLE = [
  '## Ship the offline reader', // 1
  '', // 2
  'Readers lose their place on the train.', // 3
  '', // 4
  '- [ ] https://yt.example.test/issue/READ-12 - Cache articles locally', // 5
  '- [ ] SYNC-3 - Conflict-free merge library', // 6
  '- [ ] GONE-1 - Never existed', // 7
  '- [ ] SYNC-3 again', // 8
  '', // 9
  '### Later', // 10
  '', // 11
  '- Look at READ-9 again.', // 12
].join('\n');

const keyOf = (text: string) => /([A-Z][A-Z0-9_]*-\d+)$/.exec(text)?.[1] ?? text;

/** Like VERM-101: the first scheduled occurrence of a ticket, by line, keeps its place. */
function fakeMatch(args: RunwayImportMatchArgs): RunwayImportMatchResult {
  return {
    ok: true,
    groups: args.groups.map((g) => {
      const first = new Map<string, number>();
      const out: RunwayImportCandidateMatch[] = g.candidates.map((c) => {
        const key = keyOf(c.text);
        return key.startsWith('GONE-')
          ? { ...c, status: 'unmatched' as const, code: 'missing' as const, message: 'Ticket missing.' }
          : { ...c, status: 'matched' as const, ticket: { issueId: `yt:${key}`, key, summary: key } };
      });
      g.candidates
        .map((c, i) => ({ c, i }))
        .sort((a, b) => a.c.line - b.c.line || a.i - b.i)
        .forEach(({ c, i }) => {
          const r = out[i];
          if (c.role !== 'scheduled' || r.status !== 'matched') return;
          const earlier = first.get(r.ticket.issueId);
          if (earlier !== undefined) out[i] = { ...r, status: 'duplicate', duplicateOfLine: earlier };
          else first.set(r.ticket.issueId, c.line);
        });
      return { groupKey: g.groupKey, workspaceId: g.workspaceId, ok: true as const, candidates: out, connectionKey: `conn:${g.workspaceId}` };
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function open(md: string, opts: { hold?: boolean } = {}) {
  const session = createImportSession(parseRunwaySchedule(md), 'ws-active', (args) => (opts.hold ? new Promise(() => undefined) : Promise.resolve(fakeMatch(args))), () => undefined);
  session.setWorkspaces({ state: 'ready', workspaces: WS });
  return session;
}
const st = (s: ImportSession) => ({ groups: s.state().groups ?? [], checks: s.state().checks });

describe('applyPlan', () => {
  it('the preview’s rows in order: numbered tickets by stored ID, unmatched and duplicate tickets as notes, sections and notes; References left out', async () => {
    const s = open(EXAMPLE);
    await flush();
    const { groups, checks } = st(s);
    expect(applyPlan(groups, checks)).toEqual({
      groups: [
        {
          groupKey: 'g0',
          target: { kind: 'new', name: 'Ship the offline reader', connectionWorkspaceId: 'ws-active' },
          connectionKey: 'conn:ws-active',
          rows: [
            { kind: 'note', text: 'Readers lose their place on the train.', depth: 0, line: 3 },
            { kind: 'ticket', issueId: 'yt:READ-12', text: 'https://yt.example.test/issue/READ-12', line: 5 },
            { kind: 'ticket', issueId: 'yt:SYNC-3', text: 'SYNC-3', line: 6 },
            { kind: 'note', text: 'GONE-1 Never existed', depth: 0, line: 7 },
            { kind: 'note', text: 'SYNC-3 again', depth: 0, line: 8 },
            { kind: 'section', text: 'Later', depth: 0, line: 10 },
            { kind: 'note', text: '- Look at READ-9 again.', depth: 0, line: 12 },
          ],
        },
      ],
    });
  });

  it('a ticked Reference is a ticket row at its place; skipped groups are left out; a merged heading is a section', async () => {
    const s = open(EXAMPLE + '\n\n## Extra\n- READ-40\n\n## Dropped\n- READ-50');
    await flush();
    const ref = (s.state().groups ?? [])[0];
    const read9 = ref.segments[0].references.find((r) => r.ref.ticket.key === 'READ-9');
    s.apply({ op: 'tick', groupKey: 'g0', refId: read9?.id as string, ticked: true });
    s.apply({ op: 'merge', source: 'g1', target: 'g0' });
    s.apply({ op: 'skip', groupKey: 'g2', skipped: true });
    await flush();
    const plan = applyPlan(st(s).groups, st(s).checks);
    expect(plan?.groups.map((g) => g.groupKey)).toEqual(['g0']);
    expect(plan?.groups[0].rows.slice(-4)).toEqual([
      { kind: 'note', text: '- Look at READ-9 again.', depth: 0, line: 12 },
      { kind: 'ticket', issueId: 'yt:READ-9', text: 'READ-9', line: 12 },
      { kind: 'section', text: 'Extra', depth: 0, line: 14 },
      { kind: 'ticket', issueId: 'yt:READ-40', text: 'READ-40', line: 15 },
    ]);
  });

  it('a group mapped to an existing workspace targets it; a group not yet checked gives no plan', async () => {
    const s = open('## Reader App\n- READ-1');
    await flush();
    expect(applyPlan(st(s).groups, st(s).checks)?.groups[0].target).toEqual({ kind: 'existing', workspaceId: 'ws-reader' });
    const held = open('## New\n- READ-1', { hold: true });
    expect(applyPlan(st(held).groups, st(held).checks)).toBeNull();
  });
});

describe('applyBlockers and canApply', () => {
  it('a checked new workspace with a free name is ready', async () => {
    const s = open(EXAMPLE);
    await flush();
    const b = applyBlockers(st(s).groups, st(s).checks, WS, {});
    expect(b).toEqual({ g0: [] });
    expect(canApply(st(s).groups, b)).toBe(true);
  });

  it('blocks ambiguous, unnamed, clashing, waiting, pending and failed groups', async () => {
    const s = open(['- READ-0', '', '## PLATFORM', '- PLAT-1', '', '## Inbox two', '- READ-2', '', '## Twin', '- READ-3', '', '## twin ', '- READ-4'].join('\n'));
    await flush();
    s.apply({ op: 'map', groupKey: 'g0', workspaceId: null });
    s.apply({ op: 'rename', groupKey: 'g2', name: 'inbox' });
    await flush();
    const b = applyBlockers(st(s).groups, st(s).checks, WS, {});
    expect(b).toEqual({
      g0: ['needs-name'],
      g1: ['choose-workspace', 'waiting'],
      g2: ['name-taken'],
      g3: ['name-taken'],
      g4: ['name-taken'],
    });
    expect(canApply(st(s).groups, b)).toBe(false);
    const held = open('## New\n- READ-1', { hold: true });
    expect(applyBlockers(st(held).groups, st(held).checks, WS, {})).toEqual({ g0: ['checking'] });
  });

  it('an existing destination must have an empty Runway; two groups may not share one', async () => {
    const s = open('## Reader App\n- READ-1\n\n## Other\n- READ-2');
    await flush();
    expect(applyBlockers(st(s).groups, st(s).checks, WS, {}).g0).toEqual(['runway-unknown']);
    expect(applyBlockers(st(s).groups, st(s).checks, WS, { 'ws-reader': 3 }).g0).toEqual(['runway-not-empty']);
    expect(applyBlockers(st(s).groups, st(s).checks, WS, { 'ws-reader': 0 }).g0).toEqual([]);
    s.apply({ op: 'map', groupKey: 'g1', workspaceId: 'ws-reader' });
    await flush();
    const b = applyBlockers(st(s).groups, st(s).checks, WS, { 'ws-reader': 0 });
    expect(b).toEqual({ g0: ['same-destination'], g1: ['same-destination'] });
  });

  it('skipped groups are ignored, but at least one group must be included', async () => {
    const s = open('## PLATFORM\n- PLAT-1\n\n## New one\n- READ-1');
    await flush();
    s.apply({ op: 'skip', groupKey: 'g0', skipped: true });
    expect(canApply(st(s).groups, applyBlockers(st(s).groups, st(s).checks, WS, {}))).toBe(true);
    s.apply({ op: 'skip', groupKey: 'g1', skipped: true });
    expect(canApply(st(s).groups, applyBlockers(st(s).groups, st(s).checks, WS, {}))).toBe(false);
  });
});

describe('appliedSummary', () => {
  it('names what was created and filled', () => {
    expect(appliedSummary([{ name: 'Ship the offline reader', created: true }, { name: 'Reader App', created: false }])).toBe(
      'Import applied: created Ship the offline reader; filled the Runway of Reader App.',
    );
  });
});

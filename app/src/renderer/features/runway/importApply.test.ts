import { describe, expect, it } from 'vitest';
import { parseRunwaySchedule } from '../../../shared/runwaySchedule';
import type { RunwayImportCandidateMatch, RunwayImportMatchArgs, RunwayImportMatchResult } from '../../../shared/runwayImport';
import { createImportSession, type ImportSession } from './importCorrections';
import { addsNothing, appliedSummary, applyBlockers, applyPlan, canApply, groupAppend, runwayNumbers, type DestinationView } from './importApply';
import { groupPreview } from './importCorrections';
import type { RunwayDestinationRow, RunwaySavedIdentity } from '../../../shared/runwayImportAppend';
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
/** A ready destination: its rows, and every saved ticket identified under its own ID. */
function ready(rows: RunwayDestinationRow[], extra: Record<string, RunwaySavedIdentity> = {}, connectionKey = 'conn:ws-reader'): DestinationView {
  const items: Record<string, RunwaySavedIdentity> = {};
  for (const r of rows) if (r.kind === 'issue') items[r.itemId] = { itemId: r.itemId, state: 'resolved', key: r.itemId.replace(/^yt:/, ''), aliases: [r.itemId] };
  return { state: 'ready', rows, identity: { state: 'ready', connectionKey, items: { ...items, ...extra } } };
}
const dIssue = (itemId: string): RunwayDestinationRow => ({ itemId, kind: 'issue', text: null, depth: 0 });
const dSec = (text: string, id: string): RunwayDestinationRow => ({ itemId: `sec:${id}`, kind: 'section', text, depth: 0 });
const dNote = (text: string, id: string): RunwayDestinationRow => ({ itemId: `note:${id}`, kind: 'note', text, depth: 0 });

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

  it('a mixed import applies both its tickets and its notes-only group, each checked on its connection with no ticket lookup for the notes', async () => {
    const asked: RunwayImportMatchArgs[] = [];
    const session = createImportSession(
      parseRunwaySchedule('## Ship the offline reader\n- READ-1\n\n## Reading\n\n### Later\n\nA paragraph to keep.'),
      'ws-active',
      (args) => {
        asked.push(args);
        return Promise.resolve(fakeMatch(args));
      },
      () => undefined,
    );
    session.setWorkspaces({ state: 'ready', workspaces: WS });
    await flush();
    const { groups, checks } = st(session);
    const blockers = applyBlockers(groups, checks, WS, {});
    expect(blockers).toEqual({ g0: [], g1: [] });
    expect(canApply(groups, blockers)).toBe(true);
    const plan = applyPlan(groups, checks);
    expect(plan?.groups).toEqual([
      expect.objectContaining({ groupKey: 'g0', connectionKey: 'conn:ws-active', rows: [{ kind: 'ticket', issueId: 'yt:READ-1', text: 'READ-1', line: 2 }] }),
      {
        groupKey: 'g1',
        target: { kind: 'new', name: 'Reading', connectionWorkspaceId: 'ws-active' },
        connectionKey: 'conn:ws-active',
        rows: [
          { kind: 'section', text: 'Later', depth: 0, line: 6 },
          { kind: 'note', text: 'A paragraph to keep.', depth: 0, line: 8 },
        ],
      },
    ]);
    // The notes-only group asked for its connection with no candidates, so no ticket was looked up for it.
    expect(asked.flatMap((a) => a.groups).find((g) => g.groupKey === 'g1')?.candidates).toEqual([]);
  });

  it('a group mapped to an existing workspace targets it; a group not yet checked gives no plan', async () => {
    const s = open('## Reader App\n- READ-1');
    await flush();
    expect(applyPlan(st(s).groups, st(s).checks, { 'ws-reader': ready([]) })?.groups[0].target).toEqual({ kind: 'existing', workspaceId: 'ws-reader' });
    expect(applyPlan(st(s).groups, st(s).checks, {})).toBeNull();
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

  it('two groups may not share an existing destination', async () => {
    const s = open('## Reader App\n- READ-1\n\n## Other\n- READ-2');
    await flush();
    s.apply({ op: 'map', groupKey: 'g1', workspaceId: 'ws-reader' });
    await flush();
    const b = applyBlockers(st(s).groups, st(s).checks, WS, { 'ws-reader': ready([]) });
    expect(b).toEqual({ g0: ['same-destination'], g1: ['same-destination'] });
  });

  it('an existing destination waits for its Runway, then for the tickets already on it, on the group’s connection', async () => {
    const s = open('## Reader App\n- READ-1');
    await flush();
    const { groups, checks } = st(s);
    expect(applyBlockers(groups, checks, WS, {}).g0).toEqual(['runway-unknown']);
    expect(applyBlockers(groups, checks, WS, { 'ws-reader': { state: 'failed', error: 'x' } }).g0).toEqual(['runway-failed']);
    expect(applyBlockers(groups, checks, WS, { 'ws-reader': { state: 'ready', rows: [], identity: { state: 'loading' } } }).g0).toEqual(['identity-checking']);
    expect(applyBlockers(groups, checks, WS, { 'ws-reader': { state: 'ready', rows: [], identity: { state: 'failed', error: 'x' } } }).g0).toEqual(['identity-failed']);
    // Read on another connection than the preview checked the group on: not yet comparable.
    expect(applyBlockers(groups, checks, WS, { 'ws-reader': ready([], {}, 'conn:elsewhere') }).g0).toEqual(['identity-checking']);
    expect(applyBlockers(groups, checks, WS, { 'ws-reader': ready([]) }).g0).toEqual([]);
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

describe('a repeat import into a Runway that has rows (VERM-105)', () => {
  const FILE = '## Reader App\n- READ-12\n- READ-20\n\n### Later\n\nLook again.';
  const existing = [dIssue('yt:READ-20'), dIssue('yt:READ-12'), dSec('Later', 's1'), dNote('Look again.', 'n1')];

  it('only what is new is appended: READ-20 keeps #1, the new key comes at the end, and the plan carries what was compared', async () => {
    const s = open(FILE + '\n\n- PLAT-1');
    await flush();
    const { groups, checks } = st(s);
    const dest = { 'ws-reader': ready(existing) };
    const a = groupAppend(groups[0], checks.g0, dest);
    expect(a?.plan.rows.map((r) => [r.present, r.runwayNumber])).toEqual([
      [true, 2],
      [true, 1],
      [true, null],
      [true, null],
      [false, 3],
    ]);
    expect(canApply(groups, applyBlockers(groups, checks, WS, dest), checks, dest)).toBe(true);
    expect(applyPlan(groups, checks, dest)?.groups[0]).toMatchObject({ target: { kind: 'existing', workspaceId: 'ws-reader' }, destination: { rows: existing, append: [4] } });
  });

  it('Nothing new to add: an unchanged file adds nothing, and Apply is not offered', async () => {
    const s = open(FILE);
    await flush();
    const { groups, checks } = st(s);
    const dest = { 'ws-reader': ready(existing) };
    expect(addsNothing(groups[0], checks.g0, dest)).toBe(true);
    expect(applyBlockers(groups, checks, WS, dest).g0).toEqual([]);
    expect(canApply(groups, applyBlockers(groups, checks, WS, dest), checks, dest)).toBe(false);
  });

  it('a new workspace alongside a group with nothing new still offers Apply', async () => {
    const s = open(FILE + '\n\n## Brand new\n- READ-30');
    await flush();
    const { groups, checks } = st(s);
    const dest = { 'ws-reader': ready(existing) };
    expect(canApply(groups, applyBlockers(groups, checks, WS, dest), checks, dest)).toBe(true);
  });

  it('a saved ticket that cannot be read blocks a new ticket: Unable to verify', async () => {
    const s = open('## Reader App\n- READ-12\n- PLAT-1');
    await flush();
    const { groups, checks } = st(s);
    const dest = { 'ws-reader': ready([dIssue('yt:READ-12'), dIssue('yt:READ-101')], { 'yt:READ-101': { itemId: 'yt:READ-101', state: 'unverified', key: 'READ-101', reason: 'not readable' } }) };
    expect(applyBlockers(groups, checks, WS, dest).g0).toEqual(['unable-to-verify']);
    expect(groupAppend(groups[0], checks.g0, dest)?.plan.unverified).toEqual(['READ-101']);
  });

  it('every label uses the ticket’s actual Runway #: READ-20 already #1 shows #1 on its row, its duplicate and its reference', async () => {
    const s = open('## Reader App\n- READ-12\n- READ-14\n- READ-20\n- READ-20 again\n\nSee READ-20.');
    await flush();
    const { groups, checks } = st(s);
    const check = checks.g0;
    const preview = groupPreview(groups[0], check?.state === 'done' && check.match.ok ? check.match.candidates : null);
    const dup = preview.rows.find((r) => r.kind === 'duplicate');
    const ref = preview.references.find((r) => r.status === 'matched' && r.key === 'READ-20');
    // The preview's own numbers: READ-20 is #3, and the duplicate and reference point at #3.
    expect(dup && dup.kind === 'duplicate' && dup.ofNumber).toBe(3);
    expect(ref && ref.status === 'matched' && ref.alreadyAs).toBe(3);
    const numberOf = runwayNumbers(groups[0], check, { 'ws-reader': ready([dIssue('yt:READ-20'), dIssue('yt:READ-12')]) });
    expect([1, 2, 3].map((n) => numberOf?.(n))).toEqual([2, 3, 1]);
    // A new workspace keeps the preview's numbers.
    expect(runwayNumbers({ ...groups[0], target: { kind: 'new' } }, check, {})).toBeNull();
  });

  it('while a saved ticket cannot be read, a new ticket has no number to show', async () => {
    const s = open('## Reader App\n- READ-12\n- PLAT-1');
    await flush();
    const { groups, checks } = st(s);
    const dest = { 'ws-reader': ready([dIssue('yt:READ-12'), dIssue('yt:READ-101')], { 'yt:READ-101': { itemId: 'yt:READ-101', state: 'unverified', key: 'READ-101', reason: 'gone' } }) };
    expect([1, 2].map((n) => runwayNumbers(groups[0], checks.g0, dest)?.(n))).toEqual([1, null]);
    expect(groupAppend(groups[0], checks.g0, dest)?.plan.absent).toEqual([]);
  });

  it('tickets on the Runway but not in the file are listed by key', async () => {
    const s = open('## Reader App\n- READ-12');
    await flush();
    const { groups, checks } = st(s);
    expect(groupAppend(groups[0], checks.g0, { 'ws-reader': ready(existing) })?.plan.absent).toEqual(['READ-20']);
  });
});

describe('appliedSummary', () => {
  it('names what was created and what was added to', () => {
    expect(appliedSummary([{ name: 'Ship the offline reader', created: true }, { name: 'Reader App', created: false }])).toBe(
      'Import applied: created Ship the offline reader; added to the Runway of Reader App.',
    );
  });
});

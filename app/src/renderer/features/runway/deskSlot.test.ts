import { describe, expect, it } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import { groupFocusRankHolders, type FocusRank } from '../project-board/focus';
import type { RunwayRank } from '../../../shared/runway';
import type { RunwayItem } from '../../../shared/runwayItem';
import type { RunwayTicketRead } from '../../../shared/runwayTicket';
import { buildRunwayRows } from './rows';
import { deskSlotOf, deskSlotTitle, jiraDeskSlots, runwayRowDeskSlot, youtrackDeskSlots } from './deskSlot';

// Synthetic keys only: the spec's worked example sets READ-12 Now, SYNC-3
// Next and READ-20 Then.
const EMPTY = Object.fromEntries(FIELD_KEYS.map((k): [FieldKey, null] => [k, null])) as BoardIssueFields;

function issue(key: string, id: string, focusRank: number | null, opts: { status?: string; resolved?: number } = {}): BoardIssue {
  return {
    id, idReadable: key, summary: key, resolved: opts.resolved ?? null,
    fields: { ...EMPTY, status: opts.status ?? 'To do', focus: focusRank ? 'Yes' : null, focusRank },
    parentEpic: null, isEpic: false,
  };
}

const deskOf = (perProject: Array<{ projectShortName: string; issues: BoardIssue[] }>) =>
  youtrackDeskSlots(groupFocusRankHolders(perProject));

describe('youtrackDeskSlots: the active workspace\'s Desk, exactly', () => {
  const slots = deskOf([
    { projectShortName: 'READ', issues: [issue('READ-12', '2-12', 1), issue('READ-14', '2-14', null), issue('READ-20', '2-20', 3)] },
    { projectShortName: 'SYNC', issues: [issue('SYNC-3', '2-103', 2)] },
  ]);

  it('Now, Next and Then by Focus rank 1, 2 and 3, found by entity ID or key', () => {
    expect(deskSlotOf(slots, ['2-12'])).toEqual({ rank: 1, label: 'Now', shared: false });
    expect(deskSlotOf(slots, ['SYNC-3'])).toEqual({ rank: 2, label: 'Next', shared: false });
    expect(deskSlotOf(slots, [null, undefined, 'READ-20'])?.label).toBe('Then');
  });

  it('a ticket with no rank has no slot', () => {
    expect(deskSlotOf(slots, ['2-14', 'READ-14'])).toBeNull();
  });

  it('a done or resolved ranked ticket is not on the Desk, so has no slot', () => {
    const done = deskOf([{ projectShortName: 'READ', issues: [issue('READ-12', '2-12', 1, { status: 'Done' }), issue('READ-20', '2-20', 3, { resolved: 9 })] }]);
    expect(deskSlotOf(done, ['READ-12'])).toBeNull();
    expect(deskSlotOf(done, ['READ-20'])).toBeNull();
  });

  it('a ticket outside the workspace\'s projects is not on its Desk, whatever its own rank', () => {
    // PLAT-40 carries Focus rank 1 on another workspace's Desk; this Desk read only READ.
    expect(deskSlotOf(slots, ['PLAT-40', '2-240'])).toBeNull();
  });

  it('a rank two tickets share shows on both, marked shared', () => {
    const shared = deskOf([{ projectShortName: 'READ', issues: [issue('READ-12', '2-12', 1), issue('READ-14', '2-14', 1)] }]);
    expect(deskSlotOf(shared, ['READ-12'])).toEqual({ rank: 1, label: 'Now', shared: true });
    expect(deskSlotOf(shared, ['READ-14'])?.shared).toBe(true);
    expect(deskSlotTitle(deskSlotOf(shared, ['READ-14'])!)).toBe('Priority Desk: Now, shared with another ticket. Fix it on the Desk.');
  });

  it('an empty Desk has no slots', () => {
    expect(youtrackDeskSlots(new Map<FocusRank, never[]>()).size).toBe(0);
  });
});

describe('jiraDeskSlots: the workspace\'s own Desk entries', () => {
  const slots = jiraDeskSlots(new Map<RunwayRank, string>([[1, 'OPS-956'], [3, 'OPS-4089']]));

  it('the entry\'s rank by key; never shared', () => {
    expect(deskSlotOf(slots, ['OPS-956'])).toEqual({ rank: 1, label: 'Now', shared: false });
    expect(deskSlotOf(slots, ['OPS-4089'])?.label).toBe('Then');
    expect(deskSlotOf(slots, ['OPS-12'])).toBeNull();
    expect(deskSlotTitle(deskSlotOf(slots, ['OPS-956'])!)).toBe('Priority Desk: Now');
  });
});

describe('runwayRowDeskSlot: the stored tracker first, then the stored and returned IDs (Kevin\'s review)', () => {
  const item = (itemId: string, position: number): RunwayItem => ({
    workspaceId: 'ws-e2ejd99', itemId, kind: 'issue', position, runwayNumber: null, depth: 0, text: null, addedAt: '', updatedAt: '',
  });
  const row = (itemId: string, read: RunwayTicketRead) => buildRunwayRows([item(itemId, 1)], [read])[0];
  // OPS-12 moved to OPS-956: the row is stored as jira:OPS-12, and Jira answers with the new key.
  const moved = row('jira:OPS-12', { itemId: 'jira:OPS-12', state: 'resolved', issue: { ...issue('OPS-956', '10956', null), fields: { ...EMPTY, status: 'To Do' } } });

  it('a moved Jira ticket keeps its chip, whether its Desk entry is under the stored key or the new one', () => {
    expect(moved.kind === 'ticket' && moved.ticketId).toBe('OPS-956');
    const underOld = jiraDeskSlots(new Map<RunwayRank, string>([[1, 'OPS-12']]));
    const underNew = jiraDeskSlots(new Map<RunwayRank, string>([[2, 'OPS-956']]));
    expect(runwayRowDeskSlot(underOld, 'jira', moved)).toEqual({ rank: 1, label: 'Now', shared: false });
    expect(runwayRowDeskSlot(underNew, 'jira', moved)?.label).toBe('Next');
  });

  it('a row stored for the other tracker gets no chip, even with the same key', () => {
    const desk = jiraDeskSlots(new Map<RunwayRank, string>([[1, 'OPS-956']]));
    const wrong = row('yt:OPS-956', { itemId: 'yt:OPS-956', state: 'wrong-tracker', reason: 'a YouTrack ticket on a Jira workspace' });
    expect(runwayRowDeskSlot(desk, 'jira', wrong)).toBeNull();
    // The same key stored for this workspace's tracker does get it.
    expect(runwayRowDeskSlot(desk, 'jira', row('jira:OPS-956', { itemId: 'jira:OPS-956', state: 'missing' }))?.label).toBe('Now');
  });

  it('a YouTrack row stored under its entity ID matches the Desk by that ID before it is read', () => {
    const desk = deskOf([{ projectShortName: 'READ', issues: [issue('READ-12', '2-12', 1)] }]);
    expect(runwayRowDeskSlot(desk, 'youtrack', buildRunwayRows([item('yt:2-12', 1)], null)[0])?.label).toBe('Now');
    expect(runwayRowDeskSlot(desk, 'jira', buildRunwayRows([item('yt:2-12', 1)], null)[0])).toBeNull();
  });

  it('section and note rows have none', () => {
    const section = buildRunwayRows([{ ...item('sec:1', 1), kind: 'section', text: 'Later' }], [])[0];
    expect(runwayRowDeskSlot(new Map(), 'jira', section)).toBeNull();
  });
});

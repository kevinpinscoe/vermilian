import { describe, expect, it } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import { groupFocusRankHolders, type FocusRank } from '../project-board/focus';
import type { RunwayRank } from '../../../shared/runway';
import { deskSlotOf, deskSlotTitle, jiraDeskSlots, youtrackDeskSlots } from './deskSlot';

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

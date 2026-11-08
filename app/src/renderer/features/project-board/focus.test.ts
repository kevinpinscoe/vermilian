import { describe, it, expect, vi } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import {
  isFocusRank,
  holdersOfRank,
  decideRankAssignment,
  findDuplicateRanks,
  runToggleFocus,
  runClearRank,
  runSetRank,
  withInvalidate,
  isCompletedIssue,
  groupFocusRankHolders,
  type FocusRank,
  type FocusRankHolder,
  type PatchFn,
} from './focus';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function issue(id: string, fields: Partial<BoardIssueFields> = {}, summary = id): BoardIssue {
  const emptyFields = Object.fromEntries(
    FIELD_KEYS.map((k): [FieldKey, null] => [k, null]),
  ) as BoardIssueFields;
  return {
    id,
    idReadable: id.toUpperCase(),
    summary,
    resolved: null,
    fields: { ...emptyFields, ...fields },
    parentEpic: null,
    isEpic: false,
  };
}

function holder(id: string, focusRank: FocusRank, projectShortName = 'KEVIN'): FocusRankHolder {
  return { issue: issue(id, { focusRank, focus: 'Yes' }), projectShortName };
}

function byRankOf(...holders: FocusRankHolder[]): Map<FocusRank, FocusRankHolder[]> {
  const map = new Map<FocusRank, FocusRankHolder[]>();
  for (const h of holders) {
    const rank = h.issue.fields.focusRank as FocusRank;
    const list = map.get(rank) ?? [];
    list.push(h);
    map.set(rank, list);
  }
  return map;
}

/** A PatchFn that records every call and can be told to fail on specific
 * (issueId, field) pairs — the tool for reproducing "the Nth write in a
 * multi-write sequence fails" without touching React, IPC, or a real
 * network call. */
function mockPatch(failOn: Array<[string, string]> = []): {
  patch: PatchFn;
  calls: Array<{ issueId: string; field: string; value: string | number | null }>;
} {
  const calls: Array<{ issueId: string; field: string; value: string | number | null }> = [];
  const patch: PatchFn = async (issueId, field, value) => {
    calls.push({ issueId, field, value });
    if (failOn.some(([id, f]) => id === issueId && f === field)) {
      throw new Error(`simulated failure: ${issueId}.${field}`);
    }
  };
  return { patch, calls };
}

// ─── isFocusRank ────────────────────────────────────────────────────────────

describe('isFocusRank', () => {
  it('accepts 1, 2, 3', () => {
    expect(isFocusRank(1)).toBe(true);
    expect(isFocusRank(2)).toBe(true);
    expect(isFocusRank(3)).toBe(true);
  });

  it('rejects null, undefined, 0, and out-of-range values', () => {
    expect(isFocusRank(null)).toBe(false);
    expect(isFocusRank(undefined)).toBe(false);
    expect(isFocusRank(0)).toBe(false);
    expect(isFocusRank(4)).toBe(false);
    expect(isFocusRank(-1)).toBe(false);
  });
});

// ─── holdersOfRank ──────────────────────────────────────────────────────────

describe('holdersOfRank', () => {
  it('returns every holder of a rank when nothing is excluded', () => {
    const byRank = byRankOf(holder('a', 1));
    expect(holdersOfRank(byRank, 1).map((h) => h.issue.id)).toEqual(['a']);
  });

  it('returns an empty array for an unheld rank', () => {
    const byRank = byRankOf(holder('a', 1));
    expect(holdersOfRank(byRank, 2)).toEqual([]);
  });

  it('excludes the named issue id, e.g. the issue being edited', () => {
    const byRank = byRankOf(holder('a', 1));
    expect(holdersOfRank(byRank, 1, 'a')).toEqual([]);
  });

  it('excluding one holder still returns the others sharing the same rank', () => {
    const byRank = byRankOf(holder('a', 1), holder('b', 1));
    expect(holdersOfRank(byRank, 1, 'a').map((h) => h.issue.id)).toEqual(['b']);
  });
});

// ─── decideRankAssignment ───────────────────────────────────────────────────

describe('decideRankAssignment', () => {
  it('assigns directly when no other issue holds the rank', () => {
    const byRank = byRankOf();
    expect(decideRankAssignment(byRank, 1, 'target')).toEqual({ kind: 'direct' });
  });

  it('assigns directly when the only holder is the target issue itself', () => {
    const byRank = byRankOf(holder('target', 1));
    expect(decideRankAssignment(byRank, 1, 'target')).toEqual({ kind: 'direct' });
  });

  it('asks for confirmation when exactly one other issue holds the rank', () => {
    const byRank = byRankOf(holder('a', 2));
    const decision = decideRankAssignment(byRank, 2, 'target');
    expect(decision.kind).toBe('confirm');
    if (decision.kind === 'confirm') {
      expect(decision.holder.issue.id).toBe('a');
    }
  });

  it('blocks the assignment when the rank already has two or more other holders', () => {
    const byRank = byRankOf(holder('a', 3), holder('b', 3));
    const decision = decideRankAssignment(byRank, 3, 'target');
    expect(decision.kind).toBe('blocked');
    if (decision.kind === 'blocked') {
      expect(decision.holders.map((h) => h.issue.id).sort()).toEqual(['a', 'b']);
    }
  });
});

// ─── findDuplicateRanks ─────────────────────────────────────────────────────

describe('findDuplicateRanks', () => {
  it('finds no duplicates when every rank has at most one holder', () => {
    const byRank = byRankOf(holder('a', 1), holder('b', 2), holder('c', 3));
    expect(findDuplicateRanks(byRank)).toEqual([]);
  });

  it('finds every rank held by more than one issue', () => {
    const byRank = byRankOf(holder('a', 1), holder('b', 1), holder('c', 2));
    const dups = findDuplicateRanks(byRank);
    expect(dups).toHaveLength(1);
    expect(dups[0].rank).toBe(1);
    expect(dups[0].holders.map((h) => h.issue.id).sort()).toEqual(['a', 'b']);
  });

  it('reports multiple disputed ranks independently', () => {
    const byRank = byRankOf(holder('a', 1), holder('b', 1), holder('c', 3), holder('d', 3));
    const dups = findDuplicateRanks(byRank);
    expect(dups.map((d) => d.rank).sort()).toEqual([1, 3]);
  });
});

// ─── runToggleFocus — write order and partial-failure behaviour ───────────

describe('runToggleFocus', () => {
  it('turning on makes exactly one write: focus = Yes', async () => {
    const { patch, calls } = mockPatch();
    await runToggleFocus(patch, 'a', false);
    expect(calls).toEqual([{ issueId: 'a', field: 'focus', value: 'Yes' }]);
  });

  it('turning off clears focusRank BEFORE focus', async () => {
    const { patch, calls } = mockPatch();
    await runToggleFocus(patch, 'a', true);
    expect(calls).toEqual([
      { issueId: 'a', field: 'focusRank', value: null },
      { issueId: 'a', field: 'focus', value: null },
    ]);
  });

  it('rank-clear fails while unstarring: focus is never touched, so the issue stays focused rather than losing Focus while still (invisibly) ranked', async () => {
    const { patch, calls } = mockPatch([['a', 'focusRank']]);
    await expect(runToggleFocus(patch, 'a', true)).rejects.toThrow('simulated failure: a.focusRank');
    expect(calls).toEqual([{ issueId: 'a', field: 'focusRank', value: null }]);
  });

  it('rank-clear succeeds but focus-clear fails: the rank write already landed, so no invariant-violating state is left even though the toggle overall failed', async () => {
    const { patch, calls } = mockPatch([['a', 'focus']]);
    await expect(runToggleFocus(patch, 'a', true)).rejects.toThrow('simulated failure: a.focus');
    expect(calls).toEqual([
      { issueId: 'a', field: 'focusRank', value: null },
      { issueId: 'a', field: 'focus', value: null },
    ]);
  });
});

// ─── runClearRank ───────────────────────────────────────────────────────────

describe('runClearRank', () => {
  it('makes exactly one write: focusRank = null', async () => {
    const { patch, calls } = mockPatch();
    await runClearRank(patch, 'a');
    expect(calls).toEqual([{ issueId: 'a', field: 'focusRank', value: null }]);
  });

  it('propagates a failure from the single write', async () => {
    const { patch } = mockPatch([['a', 'focusRank']]);
    await expect(runClearRank(patch, 'a')).rejects.toThrow('simulated failure: a.focusRank');
  });
});

// ─── runSetRank — displace-before-assign order and partial-failure behaviour ─

describe('runSetRank', () => {
  it('with no displacement, writes focus then rank on the target only', async () => {
    const { patch, calls } = mockPatch();
    await runSetRank(patch, { issueId: 'target' }, 2);
    expect(calls).toEqual([
      { issueId: 'target', field: 'focus', value: 'Yes' },
      { issueId: 'target', field: 'focusRank', value: 2 },
    ]);
  });

  it('with a displacement, clears the old holder BEFORE touching the target', async () => {
    const { patch, calls } = mockPatch();
    const displaced = holder('old', 2);
    await runSetRank(patch, { issueId: 'target' }, 2, displaced);
    expect(calls).toEqual([
      { issueId: 'old', field: 'focusRank', value: null },
      { issueId: 'target', field: 'focus', value: 'Yes' },
      { issueId: 'target', field: 'focusRank', value: 2 },
    ]);
  });

  it('displaced holder fails to clear: the target is never touched, so the rank stays with its original (still correct) holder rather than being duplicated', async () => {
    const { patch, calls } = mockPatch([['old', 'focusRank']]);
    const displaced = holder('old', 2);
    await expect(runSetRank(patch, { issueId: 'target' }, 2, displaced))
      .rejects.toThrow('simulated failure: old.focusRank');
    expect(calls).toEqual([{ issueId: 'old', field: 'focusRank', value: null }]);
  });

  it('displaced holder clears but assigning the new holder (focus) fails: the rank ends up held by neither issue, never by both', async () => {
    const { patch, calls } = mockPatch([['target', 'focus']]);
    const displaced = holder('old', 2);
    await expect(runSetRank(patch, { issueId: 'target' }, 2, displaced))
      .rejects.toThrow('simulated failure: target.focus');
    expect(calls).toEqual([
      { issueId: 'old', field: 'focusRank', value: null },
      { issueId: 'target', field: 'focus', value: 'Yes' },
    ]);
  });

  it('target focus succeeds but target rank assignment fails: target ends up focused-but-unranked, old holder unranked too — no duplicate rank in either outcome', async () => {
    const { patch, calls } = mockPatch([['target', 'focusRank']]);
    const displaced = holder('old', 2);
    await expect(runSetRank(patch, { issueId: 'target' }, 2, displaced))
      .rejects.toThrow('simulated failure: target.focusRank');
    expect(calls).toEqual([
      { issueId: 'old', field: 'focusRank', value: null },
      { issueId: 'target', field: 'focus', value: 'Yes' },
      { issueId: 'target', field: 'focusRank', value: 2 },
    ]);
  });
});

// ─── withInvalidate ─────────────────────────────────────────────────────────

describe('withInvalidate', () => {
  it('runs invalidate after fn succeeds', async () => {
    const invalidate = vi.fn();
    await withInvalidate(async () => {}, invalidate);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('still runs invalidate when fn throws, and re-throws the original error', async () => {
    const invalidate = vi.fn();
    await expect(
      withInvalidate(async () => { throw new Error('boom'); }, invalidate),
    ).rejects.toThrow('boom');
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('does not call invalidate more than once', async () => {
    const invalidate = vi.fn();
    await withInvalidate(async () => {}, invalidate);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

// ─── K6: completed issues hold no active rank (VERM-10 E8-E10) ─────────────
//
// The live getIssues returns resolved issues even with includeResolved:false
// (the fake honours the flag, so the deterministic suite never saw them).
// docs/requirements.md (K6, decided 2026-11-08): a Done issue leaves
// Now/Next/Then and reserves no rank; its stored Focus and Focus rank are not
// cleared; reopening it into a collision is shown for repair, no winner.

describe('isCompletedIssue', () => {
  it('treats a resolved issue as completed whatever its status', () => {
    expect(isCompletedIssue({ ...issue('a', { status: 'Wont do' }), resolved: 1794171492074 })).toBe(true);
  });
  it('treats Status Done as completed even before YouTrack reports it resolved', () => {
    expect(isCompletedIssue(issue('a', { status: 'Done' }))).toBe(true);
  });
  it('treats an unresolved, not-Done issue as active', () => {
    expect(isCompletedIssue(issue('a', { status: 'To do' }))).toBe(false);
    expect(isCompletedIssue(issue('a', { status: 'BLOCKED' }))).toBe(false);
  });
});

describe('groupFocusRankHolders', () => {
  const done = (id: string, rank: FocusRank) =>
    ({ ...issue(id, { focus: 'Yes', focusRank: rank, status: 'Done' }), resolved: 1794171492074 });
  const active = (id: string, rank: FocusRank) => issue(id, { focus: 'Yes', focusRank: rank, status: 'To do' });

  it('E8: a Done issue keeps its stored rank but holds no slot', () => {
    const doneIssue = done('vlh-7', 1);
    const byRank = groupFocusRankHolders([{ projectShortName: 'VLH', issues: [doneIssue] }]);
    expect(byRank.get(1)).toBeUndefined();
    // Nothing is rewritten: the stored values are exactly what the server returned.
    expect(doneIssue.fields.focus).toBe('Yes');
    expect(doneIssue.fields.focusRank).toBe(1);
  });

  it('E9: giving a Done issue\'s retained rank to an active issue is a direct assignment', () => {
    const byRank = groupFocusRankHolders([{ projectShortName: 'VLH', issues: [done('old', 1), active('new', 2)] }]);
    expect(decideRankAssignment(byRank, 1, 'new')).toEqual({ kind: 'direct' });
    expect(findDuplicateRanks(byRank)).toEqual([]);
  });

  it('E10: once reopened, the retained rank collides and is shown for repair with no winner', () => {
    const reopened = issue('old', { focus: 'Yes', focusRank: 1, status: 'To do' });
    const holderNow = active('new', 1);
    const byRank = groupFocusRankHolders([{ projectShortName: 'VLH', issues: [holderNow, reopened] }]);
    const dups = findDuplicateRanks(byRank);
    expect(dups).toHaveLength(1);
    expect(dups[0].rank).toBe(1);
    expect(dups[0].holders.map((h) => h.issue.id).sort()).toEqual(['new', 'old']);
    // A third claimant is refused; the repair banner is the only path.
    expect(decideRankAssignment(byRank, 1, 'third').kind).toBe('blocked');
  });

  it('keeps active holders across projects, grouped by rank', () => {
    const byRank = groupFocusRankHolders([
      { projectShortName: 'VLH', issues: [active('a', 1), done('d', 2)] },
      { projectShortName: 'VLHX', issues: [active('b', 2), issue('c', { focus: 'Yes' })] },
    ]);
    expect(byRank.get(1)?.map((h) => [h.issue.id, h.projectShortName])).toEqual([['a', 'VLH']]);
    expect(byRank.get(2)?.map((h) => [h.issue.id, h.projectShortName])).toEqual([['b', 'VLHX']]);
    expect(byRank.get(3)).toBeUndefined();
  });
});

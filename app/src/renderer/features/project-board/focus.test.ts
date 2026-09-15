import { describe, it, expect } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import {
  isFocusRank,
  holdersOfRank,
  decideRankAssignment,
  findDuplicateRanks,
  type FocusRank,
  type FocusRankHolder,
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

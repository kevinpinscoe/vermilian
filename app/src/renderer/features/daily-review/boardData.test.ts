import { describe, it, expect } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import { deriveBlockedFocused, deriveNeedsAttention } from './boardData';

function issue(id: string, fields: Partial<BoardIssueFields> = {}): BoardIssue {
  const emptyFields = Object.fromEntries(
    FIELD_KEYS.map((k): [FieldKey, null] => [k, null]),
  ) as BoardIssueFields;
  return {
    id,
    idReadable: id.toUpperCase(),
    summary: id,
    resolved: null,
    fields: { ...emptyFields, ...fields },
    parentEpic: null,
    isEpic: false,
  };
}

describe('deriveBlockedFocused', () => {
  it('includes a ranked issue whose Status is BLOCKED', () => {
    const blocked = issue('a', { focusRank: 1, focus: 'Yes', status: 'BLOCKED' });
    expect(deriveBlockedFocused([blocked])).toEqual([blocked]);
  });

  it('excludes a ranked issue that is not BLOCKED', () => {
    const inProgress = issue('a', { focusRank: 1, focus: 'Yes', status: 'In Progress' });
    expect(deriveBlockedFocused([inProgress])).toEqual([]);
  });

  it('excludes a BLOCKED issue with no Focus rank', () => {
    const unranked = issue('a', { focusRank: null, focus: null, status: 'BLOCKED' });
    expect(deriveBlockedFocused([unranked])).toEqual([]);
  });

  it('excludes an issue with an out-of-range focusRank value', () => {
    // Defends the isFocusRank(1|2|3) guard against stray data (e.g. 0 or 4)
    // that a direct '>0' or truthiness check would wrongly admit.
    const strayRank = issue('a', { focusRank: 4, focus: 'Yes', status: 'BLOCKED' });
    expect(deriveBlockedFocused([strayRank])).toEqual([]);
  });
});

describe('deriveNeedsAttention', () => {
  it('includes a starred issue with no Focus rank', () => {
    const starred = issue('a', { focus: 'Yes', focusRank: null });
    expect(deriveNeedsAttention([starred])).toEqual([starred]);
  });

  it('excludes a starred issue that already holds a Focus rank', () => {
    const ranked = issue('a', { focus: 'Yes', focusRank: 2 });
    expect(deriveNeedsAttention([ranked])).toEqual([]);
  });

  it('excludes an unstarred issue even with no Focus rank', () => {
    const unstarred = issue('a', { focus: null, focusRank: null });
    expect(deriveNeedsAttention([unstarred])).toEqual([]);
  });
});

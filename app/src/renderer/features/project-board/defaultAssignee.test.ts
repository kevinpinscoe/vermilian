import { describe, it, expect } from 'vitest';
import type { BoardIssue } from '../../../shared/workspace';
import { FIELD_KEYS } from '../../../shared/fields';
import { ASSIGNEE_ME } from './grouping';
import { defaultAssigneeFilter, defaultAssigneeView, withDefaultAssignee } from './defaultAssignee';
import { EMPTY_FILTER } from './grouping';

// Fictional values only.
function issue(key: string, assignee: string | null): BoardIssue {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as BoardIssue['fields'];
  fields.assignee = assignee;
  return { id: key, idReadable: key, summary: key, resolved: null, fields, parentEpic: null, isEpic: false, statusRole: null };
}

const ISSUES = [issue('A-1', 'me'), issue('A-2', 'other'), issue('A-3', null)];

describe('defaultAssigneeView (VERM-68)', () => {
  it('is off while the field is empty or blank', () => {
    expect(defaultAssigneeView('', false, ISSUES, 'me').mode).toBe('off');
    expect(defaultAssigneeView('   ', false, ISSUES, 'me').mode).toBe('off');
  });

  it('shows only the default assignee, as the Me pill when it is the current user', () => {
    expect(defaultAssigneeView('me', false, ISSUES, 'me')).toEqual({ mode: 'mine', value: ASSIGNEE_ME });
  });

  it('uses the saved value before the current user is known', () => {
    expect(defaultAssigneeView('me', false, ISSUES, '')).toEqual({ mode: 'mine', value: 'me' });
  });

  it('shows everyone while the toggle is on', () => {
    expect(defaultAssigneeView('me', true, ISSUES, 'me').mode).toBe('all');
  });

  it('never empties the board for an identity no loaded issue carries', () => {
    expect(defaultAssigneeView('stale', false, ISSUES, 'me').mode).toBe('unmatched');
  });

  it('stays filtered while issues are still loading', () => {
    expect(defaultAssigneeView('me', false, [], 'me').mode).toBe('mine');
  });
});

describe('defaultAssigneeFilter (VERM-68)', () => {
  it('narrows to the default assignee and keeps the other filters', () => {
    const filter = { ...EMPTY_FILTER, status: ['To do'], assignee: ['other'] };
    expect(defaultAssigneeFilter(filter, { mode: 'mine', value: ASSIGNEE_ME })).toEqual({ ...filter, assignee: [ASSIGNEE_ME] });
  });

  it('leaves the filter alone in every other mode', () => {
    const filter = { ...EMPTY_FILTER, assignee: ['other'] };
    for (const mode of ['off', 'all', 'unmatched'] as const) {
      expect(defaultAssigneeFilter(filter, { mode, value: 'me' })).toBe(filter);
    }
  });
});

describe('withDefaultAssignee (VERM-68)', () => {
  it('sets one workspace and keeps the others', () => {
    expect(withDefaultAssignee({ b: 'x' }, 'a', ' me ')).toEqual({ a: 'me', b: 'x' });
  });

  it('removes the entry when cleared', () => {
    expect(withDefaultAssignee({ a: 'me', b: 'x' }, 'a', '  ')).toEqual({ b: 'x' });
  });
});

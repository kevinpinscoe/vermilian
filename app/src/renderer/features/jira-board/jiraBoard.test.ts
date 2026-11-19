import { describe, expect, it } from 'vitest';
import type { BoardIssue, StatusRole } from '../../../shared/workspace';
import { FIELD_KEYS } from '../../../shared/fields';
import {
  describeHiddenColumns,
  isAlwaysShownStatus,
  jiraBoardColumns,
  jiraStatusOptions,
  splitHiddenColumns,
  toggleHiddenStatus,
  withAlwaysShownColumn,
} from './jiraBoard';

// Fictional values only.
function issue(key: string, status: string | null, role: StatusRole | null, priority: string | null = null, dueDate: number | null = null): BoardIssue {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, null])) as BoardIssue['fields'];
  fields.status = status;
  fields.priority = priority;
  fields.dueDate = dueDate;
  return { id: key, idReadable: key, summary: key, resolved: role === 'done' ? 1 : null, fields, parentEpic: null, isEpic: false, statusRole: role };
}

describe('jiraBoardColumns', () => {
  it('orders columns by what the status means, then by name', () => {
    const cols = jiraBoardColumns([
      issue('DEMO-1', 'Done', 'done'),
      issue('DEMO-2', 'In Review', 'inProgress'),
      issue('DEMO-3', 'Impeded', 'blocked'),
      issue('DEMO-4', 'Backlog', 'todo'),
      issue('DEMO-5', 'Building', 'inProgress'),
      issue('DEMO-6', 'On hold', 'deferred'),
      issue('DEMO-7', 'Awaiting vendor', 'waiting'),
    ]);
    expect(cols.map((c) => c.status)).toEqual(['Backlog', 'Building', 'In Review', 'Awaiting vendor', 'Impeded', 'On hold', 'Done']);
  });

  it('merges one status name across projects into one column', () => {
    const cols = jiraBoardColumns([issue('DEMO-1', 'To Do', 'todo'), issue('OPS-1', 'To Do', 'todo')]);
    expect(cols).toHaveLength(1);
    expect(cols[0].issues.map((i) => i.idReadable)).toEqual(['DEMO-1', 'OPS-1']);
  });

  it('puts statuses with no known meaning, and hidden statuses, last', () => {
    const cols = jiraBoardColumns([issue('DEMO-1', null, null), issue('DEMO-2', 'Done', 'done'), issue('DEMO-3', 'Custom', null)]);
    expect(cols.map((c) => c.status)).toEqual(['Done', '(No status)', 'Custom']);
  });

  it("sorts each column by its issues' own project priority order, then due date, then key", () => {
    const priorities = { DEMO: ['Critical', 'Highest', 'High', 'Low'], OPS: ['P1', 'P2'] };
    const cols = jiraBoardColumns(
      [
        issue('DEMO-10', 'To Do', 'todo', 'Low'),
        issue('DEMO-2', 'To Do', 'todo', 'Critical', 200),
        issue('DEMO-3', 'To Do', 'todo', 'Critical', 100),
        issue('OPS-1', 'To Do', 'todo', 'P2'),
        issue('DEMO-9', 'To Do', 'todo', null),
        issue('DEMO-11', 'To Do', 'todo', 'High'),
      ],
      priorities,
    );
    expect(cols[0].issues.map((i) => i.idReadable)).toEqual(['DEMO-3', 'DEMO-2', 'OPS-1', 'DEMO-11', 'DEMO-10', 'DEMO-9']);
  });

  it('with no priorities or due dates, sorts by key in numeric order', () => {
    const cols = jiraBoardColumns([issue('DEMO-2', 'To Do', 'todo'), issue('DEMO-10', 'To Do', 'todo'), issue('DEMO-1', 'To Do', 'todo')]);
    expect(cols[0].issues.map((i) => i.idReadable)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-10']);
  });
});

describe('splitHiddenColumns (VERM-60)', () => {
  const cols = jiraBoardColumns([
    issue('DEMO-1', 'To Do', 'todo'),
    issue('DEMO-2', 'Blocked', 'blocked'),
    issue('DEMO-3', 'Blocked', 'blocked'),
    issue('DEMO-4', 'In Progress', 'inProgress'),
  ]);

  it('hides chosen statuses by exact name and counts their issues', () => {
    const { shown, hidden } = splitHiddenColumns(cols, ['Blocked']);
    expect(shown.map((c) => c.status)).toEqual(['To Do', 'In Progress']);
    expect(hidden).toEqual([{ status: 'Blocked', count: 2 }]);
    expect(describeHiddenColumns(hidden)).toBe('1 hidden: Blocked (2)');
  });

  it('ignores a hidden status no issue is in, and a different spelling', () => {
    const { shown, hidden } = splitHiddenColumns(cols, ['Waiting', 'blocked']);
    expect(shown).toHaveLength(3);
    expect(hidden).toEqual([]);
    expect(describeHiddenColumns(hidden)).toBe('');
  });

  it('lists several hidden columns in board order', () => {
    const { hidden } = splitHiddenColumns(cols, ['Blocked', 'To Do']);
    expect(describeHiddenColumns(hidden)).toBe('2 hidden: To Do (1), Blocked (2)');
  });
});

describe('the Jira status filter (VERM-67)', () => {
  const cols = jiraBoardColumns([
    issue('DEMO-1', 'To Do', 'todo'),
    issue('DEMO-2', 'In Progress', 'inProgress'),
    issue('DEMO-3', 'Blocked', 'blocked'),
  ]);

  it('treats only the status named In Progress as always shown, in any case', () => {
    expect(isAlwaysShownStatus('In Progress')).toBe(true);
    expect(isAlwaysShownStatus(' in progress ')).toBe(true);
    expect(isAlwaysShownStatus('In Review')).toBe(false);
  });

  it('never hides In Progress, even from a saved choice', () => {
    const { shown, hidden } = splitHiddenColumns(cols, ['In Progress', 'Blocked']);
    expect(shown.map((c) => c.status)).toEqual(['To Do', 'In Progress']);
    expect(hidden).toEqual([{ status: 'Blocked', count: 1 }]);
  });

  it('lists board statuses first, then the rest by name, without repeats', () => {
    expect(jiraStatusOptions(cols, ['Done', 'To Do', 'Backlog'], ['Archived', 'Done'])).toEqual([
      'To Do', 'In Progress', 'Blocked', 'Archived', 'Backlog', 'Done',
    ]);
  });

  it('adds an empty In Progress column in workflow order when the status exists', () => {
    const noneActive = jiraBoardColumns([issue('DEMO-1', 'To Do', 'todo'), issue('DEMO-3', 'Blocked', 'blocked')]);
    const result = withAlwaysShownColumn(noneActive, ['To Do', 'In Progress', 'Blocked']);
    expect(result.map((c) => c.status)).toEqual(['To Do', 'In Progress', 'Blocked']);
    expect(result[1].issues).toEqual([]);
  });

  it('adds nothing when the column exists or the workspace has no such status', () => {
    expect(withAlwaysShownColumn(cols, ['In Progress'])).toBe(cols);
    const noneActive = jiraBoardColumns([issue('DEMO-1', 'To Do', 'todo')]);
    expect(withAlwaysShownColumn(noneActive, ['To Do', 'Waiting'])).toBe(noneActive);
  });

  it('toggles a status and drops In Progress from what is saved', () => {
    expect(toggleHiddenStatus([], 'Blocked')).toEqual(['Blocked']);
    expect(toggleHiddenStatus(['Blocked'], 'Blocked')).toEqual([]);
    expect(toggleHiddenStatus(['In Progress', 'Blocked'], 'To Do')).toEqual(['Blocked', 'To Do']);
    expect(toggleHiddenStatus(['Blocked'], 'In Progress')).toEqual(['Blocked']);
  });
});

import { describe, it, expect } from 'vitest';
import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { FIELD_KEYS, type FieldKey } from '../../../shared/fields';
import type { EffectiveColors } from './KanbanView';
import { parseYouTrackProjectFields } from '../../../shared/youtrackProjectFields';
import { projectFieldValuesFromMetadata } from '../../../shared/projectFieldValues';
import {
  groupIssues,
  groupValueOrder,
  getGroupColorMap,
  applyFilter,
  filterCount,
  sortIssues,
  applyManualOrder,
  orderedUnique,
  EMPTY_FILTER,
  ASSIGNEE_ME,
  ASSIGNEE_UNASSIGNED,
  matchesAssignee,
  assigneeOptions,
  assigneeLabel,
  assigneeNames,
  type FilterState,
} from './grouping';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function issue(id: string, fields: Partial<BoardIssueFields> = {}, summary = id): BoardIssue {
  // The tuple needs an explicit type: with strictNullChecks off, `null` infers
  // as `any`, so the callback's return type contains an implicit any.
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

// A project's own values (VERM-117): not the old fixed lists.
function project(status: string[], priority: string[] = []) {
  const f = (name: string, $type: string, values: string[]) => ({ field: { name }, $type, bundle: { values: values.map((n, ordinal) => ({ name: n, ordinal })) } });
  return projectFieldValuesFromMetadata(parseYouTrackProjectFields([
    f('Status', 'StateProjectCustomField', status),
    ...(priority.length ? [f('Priority', 'EnumProjectCustomField', priority)] : []),
  ]));
}
const STATUS_ORDER = ['Not yet started', 'To do', 'Consider', 'Done', 'Wont do'];

// ─── groupIssues ──────────────────────────────────────────────────────────────

describe('groupIssues', () => {
  it("groups by status in the project's own order, skipping empty groups", () => {
    const issues = [
      issue('a', { status: 'Done' }),
      issue('b', { status: 'To do' }),
      issue('c', { status: 'To do' }),
    ];
    const groups = groupIssues(issues, 'Status', groupValueOrder('Status', [project(STATUS_ORDER)]));
    expect(groups.map(([label]) => label)).toEqual(['To do', 'Done']);
    expect(groups[0][1].map((i) => i.id)).toEqual(['b', 'c']);
    expect(groups[1][1].map((i) => i.id)).toEqual(['a']);
  });

  it("appends values outside the project's order after it", () => {
    const issues = [
      issue('a', { status: 'Custom State' }),
      issue('b', { status: 'To do' }),
    ];
    const groups = groupIssues(issues, 'Status', STATUS_ORDER);
    expect(groups.map(([label]) => label)).toEqual(['To do', 'Custom State']);
  });

  it('keeps first-seen order when no project values are known yet — no fixed list', () => {
    const issues = [issue('a', { status: 'Done' }), issue('b', { status: 'To do' })];
    expect(groupIssues(issues, 'Status').map(([label]) => label)).toEqual(['Done', 'To do']);
  });

  it('orders values that are not in the old fixed lists (Not yet started, Consider, Wont do)', () => {
    const issues = [issue('a', { status: 'Wont do' }), issue('b', { status: 'Consider' }), issue('c', { status: 'Not yet started' })];
    const groups = groupIssues(issues, 'Status', groupValueOrder('Status', [project(STATUS_ORDER)]));
    expect(groups.map(([label]) => label)).toEqual(['Not yet started', 'Consider', 'Wont do']);
  });

  it('merges several projects in first-seen order', () => {
    const order = groupValueOrder('Status', [project(['Triage', 'Done']), undefined, project(['To do', 'Triage', 'Shipped'])]);
    expect(order).toEqual(['Triage', 'Done', 'To do', 'Shipped']);
    expect(groupValueOrder('Nope', [project(['x'])])).toEqual([]);
  });

  it('buckets null field values under "(No value)"', () => {
    const groups = groupIssues([issue('a', { status: null })], 'Status');
    expect(groups).toEqual([['(No value)', [expect.objectContaining({ id: 'a' })]]]);
  });

  it('returns a single "All" group for an unknown groupBy field', () => {
    const issues = [issue('a'), issue('b')];
    const groups = groupIssues(issues, 'Nonexistent');
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe('All');
    expect(groups[0][1]).toHaveLength(2);
  });

  it('groups by priority using the priority order', () => {
    const issues = [
      issue('a', { priority: 'Minor' }),
      issue('b', { priority: 'Critical' }),
    ];
    const groups = groupIssues(issues, 'Priority', groupValueOrder('Priority', [project(['To do'], ['Critical', 'Major', 'Minor'])]));
    expect(groups.map(([label]) => label)).toEqual(['Critical', 'Minor']);
  });
});

// ─── getGroupColorMap ─────────────────────────────────────────────────────────

describe('getGroupColorMap', () => {
  const colors: EffectiveColors = {
    Status: { 'To do': '#fff' },
    Priority: { Critical: '#f00' },
    Category: { BUG: '#0f0' },
  };

  it('returns the colour map for the grouped field', () => {
    expect(getGroupColorMap('Priority', colors)).toEqual({ Critical: '#f00' });
  });

  it('returns an empty map for an ungroupable field', () => {
    expect(getGroupColorMap('Nope', colors)).toEqual({});
  });
});

// ─── applyFilter / filterCount ────────────────────────────────────────────────

describe('applyFilter', () => {
  const issues = [
    issue('a', { status: 'To do', priority: 'Critical', category: 'BUG' }, 'Fix login crash'),
    issue('b', { status: 'Done', priority: 'Minor', category: 'TASK' }, 'Write docs'),
    issue('c', { status: 'To do', priority: 'Minor', category: 'BUG' }, 'Crash on save'),
  ];

  it('returns every issue for the empty filter', () => {
    expect(applyFilter(issues, EMPTY_FILTER)).toHaveLength(3);
  });

  it('filters by status (multi-select OR within a field)', () => {
    const f: FilterState = { ...EMPTY_FILTER, status: ['To do'] };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('combines fields with AND across fields', () => {
    const f: FilterState = { ...EMPTY_FILTER, status: ['To do'], priority: ['Minor'] };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['c']);
  });

  it('searches summary case-insensitively', () => {
    const f: FilterState = { ...EMPTY_FILTER, search: 'CRASH' };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('searches the readable id as well as the summary', () => {
    const f: FilterState = { ...EMPTY_FILTER, search: 'b' };
    // id 'B' (from idReadable) matches issue b; summaries containing 'b'? none -> only b
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['b']);
  });

  it('ignores whitespace-only search', () => {
    const f: FilterState = { ...EMPTY_FILTER, search: '   ' };
    expect(applyFilter(issues, f)).toHaveLength(3);
  });
});

describe('filterCount', () => {
  it('counts each selected value plus a non-empty search', () => {
    expect(filterCount(EMPTY_FILTER)).toBe(0);
    expect(
      filterCount({ ...EMPTY_FILTER, status: ['a', 'b'], priority: ['x'], search: 'q' }),
    ).toBe(4);
  });

  it('does not count a whitespace-only search', () => {
    expect(filterCount({ ...EMPTY_FILTER, search: '  ' })).toBe(0);
  });

  it('counts an active due-date filter as one', () => {
    expect(filterCount({ ...EMPTY_FILTER, dueMode: 'before', dueFrom: '2026-06-15' })).toBe(1);
    expect(filterCount({ ...EMPTY_FILTER, dueMode: 'any' })).toBe(0);
  });
});

// ─── applyFilter: assignee (VERM-62) ──────────────────────────────────────────

describe('applyFilter (assignee)', () => {
  const issues = [
    issue('mine',   { assignee: 'kevin', status: 'To do',       priority: 'Major' }),
    issue('alice',  { assignee: 'alice', status: 'In Progress', priority: 'Major' }),
    issue('bob',    { assignee: 'bob',   status: 'To do',       priority: 'Minor' }),
    issue('nobody', { assignee: null,    status: 'To do',       priority: 'Major' }),
  ];
  const ids = (f: FilterState, me = 'kevin') => applyFilter(issues, f, me).map((i) => i.id);

  it('an empty selection keeps every issue', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: [] })).toEqual(['mine', 'alice', 'bob', 'nobody']);
  });

  it('a named assignee keeps only their issues', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: ['alice'] })).toEqual(['alice']);
  });

  it('several assignees are ORed', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: ['alice', 'bob'] })).toEqual(['alice', 'bob']);
  });

  it('Me resolves to the configured login', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: [ASSIGNEE_ME] })).toEqual(['mine']);
    expect(ids({ ...EMPTY_FILTER, assignee: [ASSIGNEE_ME] }, 'bob')).toEqual(['bob']);
  });

  it('Me with no configured login matches nothing, rather than everything', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: [ASSIGNEE_ME] }, '')).toEqual([]);
  });

  it('Unassigned keeps only issues with no assignee', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: [ASSIGNEE_UNASSIGNED] })).toEqual(['nobody']);
  });

  it('Me and Unassigned combine with OR', () => {
    expect(ids({ ...EMPTY_FILTER, assignee: [ASSIGNEE_ME, ASSIGNEE_UNASSIGNED] })).toEqual(['mine', 'nobody']);
  });

  it('is ANDed with Status and Priority', () => {
    const f: FilterState = {
      ...EMPTY_FILTER,
      assignee: [ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, 'bob'],
      status: ['To do'],
      priority: ['Major'],
    };
    expect(ids(f)).toEqual(['mine', 'nobody']);
  });

  it('counts each selected assignee in filterCount', () => {
    expect(filterCount({ ...EMPTY_FILTER, assignee: [ASSIGNEE_ME, 'alice'] })).toBe(2);
  });

  it('matchesAssignee leaves unassigned issues out of a named selection', () => {
    expect(matchesAssignee(null, ['alice', ASSIGNEE_ME], 'kevin')).toBe(false);
  });
});

describe('assigneeOptions', () => {
  const issues = [
    issue('a', { assignee: 'zoe' }),
    issue('b', { assignee: 'kevin' }),
    issue('c', { assignee: 'alice' }),
    issue('d', { assignee: 'zoe' }),
    issue('e', { assignee: null }),
  ];

  it('lists Me, Unassigned, then the other assignees alphabetically, without duplicates', () => {
    expect(assigneeOptions(issues, 'kevin')).toEqual([ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, 'alice', 'zoe']);
  });

  it('omits Me when no login is configured, and lists that user by login instead', () => {
    expect(assigneeOptions(issues, '')).toEqual([ASSIGNEE_UNASSIGNED, 'alice', 'kevin', 'zoe']);
  });

  it('labels the two tokens for display and passes logins through', () => {
    expect(assigneeLabel(ASSIGNEE_ME)).toBe('Me');
    expect(assigneeLabel(ASSIGNEE_UNASSIGNED)).toBe('Unassigned');
    expect(assigneeLabel('alice')).toBe('alice');
  });
});

describe('assignee display names (Jira accountIds)', () => {
  const withName = (id: string, accountId: string | null, name: string | null): BoardIssue =>
    ({ ...issue(id, { assignee: accountId }), assigneeName: name });
  const issues = [withName('a', 'acc-z', 'Zed'), withName('b', 'acc-a', 'Amy'), withName('c', 'acc-me', 'Me Myself'), withName('d', null, null)];

  it('collects names by accountId and labels pills with them', () => {
    const names = assigneeNames(issues);
    expect(names).toEqual({ 'acc-z': 'Zed', 'acc-a': 'Amy', 'acc-me': 'Me Myself' });
    expect(assigneeLabel('acc-a', names)).toBe('Amy');
    expect(assigneeLabel(ASSIGNEE_ME, names)).toBe('Me');
  });

  it('orders the other assignees by display name, not by accountId', () => {
    expect(assigneeOptions(issues, 'acc-me')).toEqual([ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, 'acc-a', 'acc-z']);
  });

  it('Me matches the configured accountId', () => {
    const f: FilterState = { ...EMPTY_FILTER, assignee: [ASSIGNEE_ME] };
    expect(applyFilter(issues, f, 'acc-me').map((i) => i.id)).toEqual(['c']);
  });
});

describe('applyFilter (board search text with assignee)', () => {
  it('matches key or summary, ignoring case, ANDed with the assignee', () => {
    const issues = [
      issue('demo-101', { assignee: 'kevin' }, 'Rotate the staging credentials'),
      issue('demo-102', { assignee: 'alice' }, 'Rotate the backups'),
      issue('ops-7', { assignee: null }, 'Review thresholds'),
    ];
    expect(applyFilter(issues, { ...EMPTY_FILTER, search: 'ROTATE' }).map((i) => i.id)).toEqual(['demo-101', 'demo-102']);
    expect(applyFilter(issues, { ...EMPTY_FILTER, search: 'ops-7' }).map((i) => i.id)).toEqual(['ops-7']);
    expect(applyFilter(issues, { ...EMPTY_FILTER, search: 'rotate', assignee: [ASSIGNEE_ME] }, 'kevin').map((i) => i.id)).toEqual(['demo-101']);
  });
});

// ─── applyFilter: due-date ────────────────────────────────────────────────────

describe('applyFilter (due date)', () => {
  // Stored due dates are local-midnight epochs, matching dateStrToEpoch.
  const day = (s: string) => new Date(s + 'T00:00:00').getTime();
  const issues = [
    issue('early', { dueDate: day('2026-06-10') }),
    issue('mid',   { dueDate: day('2026-06-15') }),
    issue('late',  { dueDate: day('2026-06-20') }),
    issue('none',  { dueDate: null }),
  ];

  it("'any' mode returns every issue, including undated", () => {
    expect(applyFilter(issues, { ...EMPTY_FILTER, dueMode: 'any' })).toHaveLength(4);
  });

  it("'before' keeps only earlier-dated issues and drops undated", () => {
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'before', dueFrom: '2026-06-15' };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['early']);
  });

  it("'on' keeps only the exact day", () => {
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'on', dueFrom: '2026-06-15' };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['mid']);
  });

  it("'after' keeps only later-dated issues", () => {
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'after', dueFrom: '2026-06-15' };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['late']);
  });

  it("'range' keeps inclusive between from and to", () => {
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'range', dueFrom: '2026-06-10', dueTo: '2026-06-15' };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['early', 'mid']);
  });

  it("'range' with only a lower bound is open-ended upward", () => {
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'range', dueFrom: '2026-06-15', dueTo: null };
    expect(applyFilter(issues, f).map((i) => i.id)).toEqual(['mid', 'late']);
  });

  it('an active due filter without any chosen date matches nothing dated arbitrarily', () => {
    // before/on/after with no anchor date should not match anything.
    const f: FilterState = { ...EMPTY_FILTER, dueMode: 'before', dueFrom: null };
    expect(applyFilter(issues, f)).toHaveLength(0);
  });
});

// ─── sortIssues ───────────────────────────────────────────────────────────────

describe('sortIssues', () => {
  it('returns the original array reference when no sort is given', () => {
    const issues = [issue('a'), issue('b')];
    expect(sortIssues(issues, undefined)).toBe(issues);
  });

  it('sorts by summary ascending and descending', () => {
    const issues = [issue('b', {}, 'Banana'), issue('a', {}, 'Apple'), issue('c', {}, 'Cherry')];
    expect(sortIssues(issues, { field: 'summary', direction: 'asc' }).map((i) => i.summary))
      .toEqual(['Apple', 'Banana', 'Cherry']);
    expect(sortIssues(issues, { field: 'summary', direction: 'desc' }).map((i) => i.summary))
      .toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('places null field values last regardless of direction', () => {
    const issues = [
      issue('a', { dueDate: 200 }),
      issue('b', { dueDate: null }),
      issue('c', { dueDate: 100 }),
    ];
    expect(sortIssues(issues, { field: 'dueDate', direction: 'asc' }).map((i) => i.id))
      .toEqual(['c', 'a', 'b']);
    expect(sortIssues(issues, { field: 'dueDate', direction: 'desc' }).map((i) => i.id))
      .toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const issues = [issue('b', {}, 'B'), issue('a', {}, 'A')];
    const before = issues.map((i) => i.id);
    sortIssues(issues, { field: 'summary', direction: 'asc' });
    expect(issues.map((i) => i.id)).toEqual(before);
  });
});

// ─── applyManualOrder ─────────────────────────────────────────────────────────

describe('applyManualOrder', () => {
  it('orders issues to match the id array', () => {
    const issues = [issue('a'), issue('b'), issue('c')];
    expect(applyManualOrder(issues, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends issues missing from the order at the end, preserving relative order', () => {
    const issues = [issue('a'), issue('b'), issue('c'), issue('d')];
    expect(applyManualOrder(issues, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('does not mutate the input array', () => {
    const issues = [issue('a'), issue('b')];
    applyManualOrder(issues, ['b', 'a']);
    expect(issues.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

// ─── orderedUnique ────────────────────────────────────────────────────────────

describe('orderedUnique', () => {
  it('dedups and orders by the canonical order, dropping nulls', () => {
    const values = ['Done', null, 'To do', 'Done', 'To do'];
    expect(orderedUnique(values, STATUS_ORDER)).toEqual(['To do', 'Done']);
  });

  it('appends values not in the canonical order', () => {
    expect(orderedUnique(['Weird', 'To do'], STATUS_ORDER)).toEqual(['To do', 'Weird']);
  });
});

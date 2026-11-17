// Pure board logic — grouping, filtering, sorting, and manual ordering of issues.
// Extracted from ProjectBoard.tsx so it can be unit-tested without React/dnd-kit.

import type { BoardIssue, BoardIssueFields } from '../../../shared/workspace';
import { PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';
import type { BoardSortConfig } from '../../../shared/boardConfig';
import type { EffectiveColors } from './KanbanView';

// ─── Grouping ─────────────────────────────────────────────────────────────────

export const STATUS_ORDER = [
  'To do', 'In Progress', 'Working on it', 'Waiting for IT', 'BLOCKED',
  'Waiting for approval', 'Waiting for customer', 'Waiting on external resource', 'Done',
];

export const GROUP_FIELD_MAP: Record<string, { key: keyof BoardIssueFields; colorKey: keyof EffectiveColors }> = {
  Status:   { key: 'status',   colorKey: 'Status'   },
  Priority: { key: 'priority', colorKey: 'Priority' },
  Category: { key: 'category', colorKey: 'Category' },
};

const GROUP_ORDER: Record<string, readonly string[]> = {
  Status:   STATUS_ORDER,
  Priority: PRIORITY_OPTIONS,
  Category: CATEGORY_OPTIONS,
};

export function groupIssues(
  issues: BoardIssue[],
  groupBy: string,
): Array<[string, BoardIssue[]]> {
  const mapping = GROUP_FIELD_MAP[groupBy];
  if (!mapping) return [['All', issues]];

  const map = new Map<string, BoardIssue[]>();
  for (const issue of issues) {
    const val = (issue.fields[mapping.key] as string | null) ?? '(No value)';
    if (!map.has(val)) map.set(val, []);
    map.get(val)!.push(issue);
  }

  const order = GROUP_ORDER[groupBy] ?? [];
  const result: Array<[string, BoardIssue[]]> = [];
  for (const val of order) {
    if (map.has(val)) result.push([val, map.get(val)!]);
  }
  for (const [val, grp] of map) {
    if (!(order as readonly string[]).includes(val)) result.push([val, grp]);
  }
  return result;
}

export function getGroupColorMap(groupBy: string, colors: EffectiveColors): Record<string, string> {
  const mapping = GROUP_FIELD_MAP[groupBy];
  return mapping ? colors[mapping.colorKey] : {};
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export type DueDateMode = 'any' | 'before' | 'on' | 'after' | 'range';

export interface FilterState {
  status: string[];
  priority: string[];
  category: string[];
  assignee: string[]; // YouTrack logins, plus the ASSIGNEE_ME / ASSIGNEE_UNASSIGNED tokens
  search: string; // free text over summary + idReadable
  dueMode: DueDateMode;
  dueFrom: string | null; // 'YYYY-MM-DD' — anchor for before/on/after, lower bound for range
  dueTo: string | null;   // 'YYYY-MM-DD' — upper bound for range
}

export const EMPTY_FILTER: FilterState = {
  status: [], priority: [], category: [], assignee: [], search: '',
  dueMode: 'any', dueFrom: null, dueTo: null,
};

// "Me" is stored as a token, not a login, and resolved against the configured
// youtrackLogin at filter time — so it means whoever is signed in on this
// machine. Neither token can collide with a real login (logins have no '__').
export const ASSIGNEE_ME = '__me__';
export const ASSIGNEE_UNASSIGNED = '__unassigned__';

export function filterCount(filter: FilterState): number {
  return filter.status.length + filter.priority.length + filter.category.length +
    filter.assignee.length +
    (filter.search.trim() ? 1 : 0) +
    (filter.dueMode !== 'any' ? 1 : 0);
}

// OR within the selection. "Me" with no configured login matches nothing
// rather than everything, so it never silently widens the board.
export function matchesAssignee(assignee: string | null, selected: string[], myLogin: string): boolean {
  if (selected.length === 0) return true;
  if (assignee == null) return selected.includes(ASSIGNEE_UNASSIGNED);
  if (selected.includes(assignee)) return true;
  return myLogin !== '' && assignee === myLogin && selected.includes(ASSIGNEE_ME);
}

// Display names by assignee value, for backends whose assignee value is an
// opaque id (Jira's accountId, carried with BoardIssue.assigneeName). Empty
// for YouTrack, whose logins are shown as they are.
export function assigneeNames(issues: BoardIssue[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const i of issues) {
    if (i.fields.assignee && i.assigneeName) names[i.fields.assignee] = i.assigneeName;
  }
  return names;
}

export function assigneeLabel(value: string, names: Record<string, string> = {}): string {
  if (value === ASSIGNEE_ME) return 'Me';
  if (value === ASSIGNEE_UNASSIGNED) return 'Unassigned';
  return names[value] ?? value;
}

// Pill values for the Assignee section: Me (when the current user is known),
// Unassigned, then every other assignee on the loaded issues, by display name.
// The current user's own value is left out — the Me pill already covers it.
export function assigneeOptions(issues: BoardIssue[], myLogin: string): string[] {
  const names = assigneeNames(issues);
  const others = new Set<string>();
  for (const i of issues) {
    const a = i.fields.assignee;
    if (a && a !== myLogin) others.add(a);
  }
  return [
    ...(myLogin ? [ASSIGNEE_ME] : []),
    ASSIGNEE_UNASSIGNED,
    ...[...others].sort((a, b) => assigneeLabel(a, names).localeCompare(assigneeLabel(b, names))),
  ];
}

// Local calendar day of an epoch-ms timestamp as 'YYYY-MM-DD'. Lexicographic
// comparison of these strings matches chronological order, and using local
// components keeps it consistent with how due dates are stored (local midnight).
function epochToDayStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function matchesDue(dueDate: number | null, filter: FilterState): boolean {
  if (filter.dueMode === 'any') return true;
  if (dueDate == null) return false; // an active due filter excludes undated issues
  const day = epochToDayStr(dueDate);
  switch (filter.dueMode) {
    case 'before': return filter.dueFrom != null && day < filter.dueFrom;
    case 'on':     return filter.dueFrom != null && day === filter.dueFrom;
    case 'after':  return filter.dueFrom != null && day > filter.dueFrom;
    case 'range':
      if (filter.dueFrom != null && day < filter.dueFrom) return false;
      if (filter.dueTo != null && day > filter.dueTo) return false;
      return filter.dueFrom != null || filter.dueTo != null;
    default: return true;
  }
}

export function applyFilter(issues: BoardIssue[], filter: FilterState, myLogin = ''): BoardIssue[] {
  const q = filter.search.trim().toLowerCase();
  return issues.filter((issue) => {
    if (filter.status.length > 0 && !filter.status.includes(issue.fields.status ?? '')) return false;
    if (filter.priority.length > 0 && !filter.priority.includes(issue.fields.priority ?? '')) return false;
    if (filter.category.length > 0 && !filter.category.includes(issue.fields.category ?? '')) return false;
    if (!matchesAssignee(issue.fields.assignee, filter.assignee, myLogin)) return false;
    if (q && !issue.summary.toLowerCase().includes(q) && !issue.idReadable.toLowerCase().includes(q)) return false;
    if (!matchesDue(issue.fields.dueDate, filter)) return false;
    return true;
  });
}

// Sort values within a group. Non-null values sort before null.
export function sortIssues(issues: BoardIssue[], sort: BoardSortConfig | undefined): BoardIssue[] {
  if (!sort) return issues;
  const { field, direction } = sort;
  return [...issues].sort((a, b) => {
    let av: string | number | null;
    let bv: string | number | null;
    if (field === 'summary') {
      av = a.summary; bv = b.summary;
    } else if (field === 'dueDate' || field === 'dateTimeEntered') {
      av = a.fields[field]; bv = b.fields[field];
    } else {
      av = a.fields[field as keyof typeof a.fields] as string | null;
      bv = b.fields[field as keyof typeof b.fields] as string | null;
    }
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return direction === 'asc' ? cmp : -cmp;
  });
}

// Apply a manual issue ordering (from issueOrderByGroup). Issues not in the order
// array are appended at the end in their original relative order.
export function applyManualOrder(issues: BoardIssue[], order: string[]): BoardIssue[] {
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return [...issues].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : order.length;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : order.length;
    return ai - bi;
  });
}

export function orderedUnique(
  values: (string | null)[],
  order: readonly string[],
): string[] {
  const set = new Set(values.filter((v): v is string => Boolean(v)));
  const result: string[] = [];
  for (const v of order) { if (set.has(v)) result.push(v); }
  for (const v of set) { if (!result.includes(v)) result.push(v); }
  return result;
}

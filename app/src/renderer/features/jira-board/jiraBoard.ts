// Pure layout for the read-only Jira workspace board (VERM-34).
//
// Columns are the workflow status names the issues carry, ordered by what the
// status means (its StatusRole, from the project's status mapping or Jira's
// status category, VERM-31) and then by name, so "To Do" comes before "In
// Review" before "Done" whatever each project calls them. Within a column,
// issues sort by their own project's priority order (VERM-30), then due date,
// then key.
//
// Pure TypeScript: unit-tested without React.

import type { BoardIssue, StatusRole } from '../../../shared/workspace';
import { priorityOrdinal } from '../../../shared/priority';
import { jiraProjectKeyOf } from '../../../shared/jiraBoardIssue';

export const ROLE_ORDER: readonly StatusRole[] = ['todo', 'inProgress', 'waiting', 'blocked', 'deferred', 'done'];

export interface JiraBoardColumn {
  status: string; // the workflow status name; '(No status)' when hidden
  role: StatusRole | null;
  issues: BoardIssue[];
}

const NO_STATUS = '(No status)';

function roleRank(role: StatusRole | null | undefined): number {
  const i = role ? ROLE_ORDER.indexOf(role) : -1;
  return i === -1 ? ROLE_ORDER.length : i;
}

/** Compare two issues by their projects' priority orders, due date, then key. */
export function compareJiraIssues(a: BoardIssue, b: BoardIssue, priorities: Readonly<Record<string, readonly string[]>>): number {
  const pa = priorityOrdinal(a.fields.priority, priorities[jiraProjectKeyOf(a.idReadable)] ?? []);
  const pb = priorityOrdinal(b.fields.priority, priorities[jiraProjectKeyOf(b.idReadable)] ?? []);
  if (pa !== pb) return pa - pb;
  const da = a.fields.dueDate ?? Number.POSITIVE_INFINITY;
  const db = b.fields.dueDate ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  return a.idReadable.localeCompare(b.idReadable, undefined, { numeric: true });
}

/**
 * The board's columns. A status name shared by several projects is one
 * column; it takes the most advanced role any of its issues has only when
 * they disagree, so a column never splits by project.
 */
export function jiraBoardColumns(issues: readonly BoardIssue[], priorities: Readonly<Record<string, readonly string[]>> = {}): JiraBoardColumn[] {
  const byStatus = new Map<string, JiraBoardColumn>();
  for (const issue of issues) {
    const status = issue.fields.status ?? NO_STATUS;
    let col = byStatus.get(status);
    if (!col) {
      col = { status, role: issue.statusRole ?? null, issues: [] };
      byStatus.set(status, col);
    } else if (roleRank(issue.statusRole) < roleRank(col.role)) {
      col.role = issue.statusRole ?? null;
    }
    col.issues.push(issue);
  }
  const cols = [...byStatus.values()];
  for (const c of cols) c.issues.sort((a, b) => compareJiraIssues(a, b, priorities));
  return cols.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.status.localeCompare(b.status));
}

/** In Progress can never be filtered out (VERM-67); only that name, in any case. */
export function isAlwaysShownStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'in progress';
}

/** Every status the filter offers: the board's columns in order, then the rest by name. */
export function jiraStatusOptions(
  columns: readonly JiraBoardColumn[],
  knownStatuses: readonly string[],
  hiddenStatuses: readonly string[],
): string[] {
  const onBoard = columns.map((c) => c.status);
  const rest = [...new Set([...knownStatuses, ...hiddenStatuses])].filter((s) => !onBoard.includes(s));
  return [...onBoard, ...rest.sort((a, b) => a.localeCompare(b))];
}

/** The columns with In Progress added, empty, when the workspace has that status but no issue is in it. */
export function withAlwaysShownColumn(
  columns: JiraBoardColumn[],
  knownStatuses: readonly string[],
): JiraBoardColumn[] {
  if (columns.some((c) => isAlwaysShownStatus(c.status))) return columns;
  const status = knownStatuses.find(isAlwaysShownStatus);
  if (status === undefined) return columns;
  return [...columns, { status, role: 'inProgress' as const, issues: [] }]
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.status.localeCompare(b.status));
}

/** The hidden list after one status is switched; In Progress is never kept in it. */
export function toggleHiddenStatus(hiddenStatuses: readonly string[], status: string): string[] {
  const next = hiddenStatuses.includes(status)
    ? hiddenStatuses.filter((s) => s !== status)
    : [...hiddenStatuses, status];
  return next.filter((s) => !isAlwaysShownStatus(s));
}

/** A hidden column, by status name, with how many loaded issues it holds. */
export interface HiddenJiraColumn {
  status: string;
  count: number;
}

/**
 * Splits the board's columns into those shown and those the workspace hides
 * by status name (VERM-60). Hidden columns keep their counts, in board order,
 * so their issues are never dropped silently. Matching is exact, as column
 * names are. A hidden status no issue is in has no column and no entry.
 */
export function splitHiddenColumns(
  columns: readonly JiraBoardColumn[],
  hiddenStatuses: readonly string[],
): { shown: JiraBoardColumn[]; hidden: HiddenJiraColumn[] } {
  const hide = new Set(hiddenStatuses.filter((s) => !isAlwaysShownStatus(s)));
  const shown: JiraBoardColumn[] = [];
  const hidden: HiddenJiraColumn[] = [];
  for (const col of columns) {
    if (hide.has(col.status)) hidden.push({ status: col.status, count: col.issues.length });
    else shown.push(col);
  }
  return { shown, hidden };
}

/** The hidden-columns line: "2 hidden: Blocked (4), Waiting (1)"; '' when none. */
export function describeHiddenColumns(hidden: readonly HiddenJiraColumn[]): string {
  if (hidden.length === 0) return '';
  return `${hidden.length} hidden: ${hidden.map((h) => `${h.status} (${h.count})`).join(', ')}`;
}

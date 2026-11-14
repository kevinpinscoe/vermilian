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

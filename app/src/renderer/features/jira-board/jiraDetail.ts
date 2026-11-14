// What the read-only Jira issue detail panel shows (VERM-35).
//
// A Jira issue fills only the BoardIssue fields mapJiraIssue maps: status,
// priority and due date. Every other field in the registry (Category, Ticket,
// Notes, Focus, Ghostty tab name, Repo URL, …) is a YouTrack custom field with
// no Jira counterpart, so the panel lists only these and never offers an edit.

import type { FieldKey } from '../../../shared/fields';
import type { IssueDetail, StatusRole } from '../../../shared/workspace';

/** The only fields a Jira issue carries, in panel order. */
export const JIRA_DETAIL_FIELD_KEYS = ['status', 'priority', 'dueDate'] as const satisfies readonly FieldKey[];

export interface JiraDetailRow {
  key: string;
  label: string;
  value: string; // '—' when empty
}

// A due date with its year; the panel may show one far from today. (Not
// KanbanView's formatDate, which drops the year and would pull React into
// this module's unit tests.)
export function formatDueDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ROLE_LABELS: Record<StatusRole, string> = {
  todo: 'To do',
  inProgress: 'In progress',
  waiting: 'Waiting',
  blocked: 'Blocked',
  deferred: 'Deferred',
  done: 'Done',
};

export function jiraDetailRows(issue: IssueDetail): JiraDetailRow[] {
  const { status, priority, dueDate } = issue.fields;
  const role = issue.statusRole ? ROLE_LABELS[issue.statusRole] : null;
  const rows: JiraDetailRow[] = [
    // The workflow's own name, with what Vermilian reads it as when they differ.
    { key: 'status', label: 'Status', value: status ? (role && role.toLowerCase() !== status.toLowerCase() ? `${status} (${role})` : status) : '—' },
    { key: 'priority', label: 'Priority', value: priority || '—' },
    { key: 'dueDate', label: 'Due date', value: dueDate !== null ? formatDueDate(dueDate) : '—' },
  ];
  if (issue.parentEpic) {
    const { idReadable, summary } = issue.parentEpic;
    rows.push({ key: 'epic', label: 'Epic', value: summary ? `${idReadable} — ${summary}` : idReadable });
  }
  return rows;
}

/** A comment's timestamp line: "Nov 14, 2026, 9:05 AM", "(edited …)" when edited. */
export function commentTimeLabel(created: number | null, updated: number | null): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const base = created !== null ? fmt(created) : '';
  if (updated === null) return base;
  return base ? `${base} (edited ${fmt(updated)})` : `edited ${fmt(updated)}`;
}

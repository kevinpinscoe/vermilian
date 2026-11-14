// Jira issue → provider-neutral BoardIssue (VERM-29, ADR-0011).
//
// The board, the detail panel and the Priority Desk all read BoardIssue, so a
// Jira issue is reduced to the same shape a YouTrack issue is:
//
//   id / idReadable  the Jira issue id and key (local IDs, not namespaced —
//                    a provider only ever sees its own backend's issues)
//   status           the Jira status name, as the project's workflow names it
//   statusRole       what that status means: the project's status mapping,
//                    else the status category (VERM-31, jiraProjectSettings)
//   resolved         set when the role is done: resolutiondate, else
//                    updated; null otherwise
//   priority         the Jira priority name; null when the project's scheme
//                    has no priority field or it is hidden
//   dueDate          the project's chosen due-date field (system `duedate`
//                    unless it uses a custom one, VERM-31), as epoch ms at
//                    12:00 UTC on that calendar day
//   parentEpic       the `parent` when it is an Epic; the legacy Epic Link
//                    field as a fallback when one is configured
//   isEpic           the issue's own type is an Epic
//
// Every other BoardIssueFields entry is a YouTrack-only field (Category,
// Ticket, Focus, …) and is null: such fields do not exist in Jira (proposal
// §3). Any Jira field may be absent from a response — hidden from the user, or
// not on the project's screens — so every read tolerates a missing value.
//
// Pure TypeScript: no Electron, no React.

import { FIELD_KEYS, type BoardIssueFields, type FieldKey } from './fields';
import type { BoardIssue, IssueDetail, ParentEpic } from './workspace';
import { JIRA_SYSTEM_DUE_DATE_FIELD, jiraStatusRole, type JiraProjectSettings, type JiraStatusValue } from './jiraProjectSettings';

export { JIRA_SYSTEM_DUE_DATE_FIELD };

/** How one project's issues are mapped: its JiraProjectSettings. */
export type JiraMappingOptions = JiraProjectSettings;

/** Base fields every board query requests. */
export const JIRA_BOARD_BASE_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'parent',
  'resolutiondate',
  'updated',
] as const;

/** The fields to request so mapJiraIssue has everything it reads. */
export function jiraBoardFields(options: JiraMappingOptions = {}): string[] {
  const fields: string[] = [...JIRA_BOARD_BASE_FIELDS, options.dueDateField || JIRA_SYSTEM_DUE_DATE_FIELD];
  if (options.epicLinkField) fields.push(options.epicLinkField);
  return [...new Set(fields)];
}

/** The detail view additionally needs the issue's project. */
export function jiraDetailFields(options: JiraMappingOptions = {}): string[] {
  return [...jiraBoardFields(options), 'project'];
}

interface JiraIssueType {
  name?: string;
  // Jira Cloud's issue hierarchy: -1 sub-task, 0 standard, 1 Epic, higher
  // levels for plan-only types (Initiative).
  hierarchyLevel?: number;
}

interface JiraParent {
  id?: string;
  key?: string;
  fields?: {
    summary?: string | null;
    issuetype?: JiraIssueType | null;
  } | null;
}

/** A Jira issue as search/jql or GET /issue returns it; every field optional. */
export interface JiraIssue {
  id: string;
  key: string;
  fields?: Record<string, unknown> | null;
}

function isEpicType(t: JiraIssueType | null | undefined): boolean {
  if (!t) return false;
  if (typeof t.hierarchyLevel === 'number') return t.hierarchyLevel === 1;
  return t.name?.toLowerCase() === 'epic';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function named(v: unknown): string | null {
  return v && typeof v === 'object' ? str((v as { name?: unknown }).name) : null;
}

function timestampMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A Jira date (`2026-11-20`) or date-time (a custom field may be either) as
 * epoch ms at 12:00 UTC on that calendar day. Noon keeps the day the same in
 * any time zone within ±11 h when the renderer formats it locally.
 */
export function jiraDateToEpochMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, 12);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

function emptyFields(): BoardIssueFields {
  return Object.fromEntries(FIELD_KEYS.map((k): [FieldKey, null] => [k, null])) as BoardIssueFields;
}

function parentEpicOf(fields: Record<string, unknown>, options: JiraMappingOptions): ParentEpic | null {
  const parent = fields.parent as JiraParent | null | undefined;
  if (parent && parent.key && isEpicType(parent.fields?.issuetype)) {
    return { id: parent.id || parent.key, idReadable: parent.key, summary: parent.fields?.summary ?? '' };
  }
  // Legacy Epic Link: a custom field holding just the epic's key. No summary
  // comes with it; the key stands in for the id.
  if (options.epicLinkField) {
    const key = str(fields[options.epicLinkField]);
    if (key) return { id: key, idReadable: key, summary: '' };
  }
  return null;
}

// "Resolved, time unknown": a Done issue with neither resolutiondate nor
// updated. Non-null and truthy, as every consumer of `resolved` expects.
const RESOLVED_TIME_UNKNOWN = 1;

export function mapJiraIssue(issue: JiraIssue, options: JiraMappingOptions = {}): BoardIssue {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const status = f.status as JiraStatusValue | null | undefined;
  const statusRole = jiraStatusRole(status, options.statusRoles);
  const done = statusRole === 'done';

  const fields = emptyFields();
  fields.status = named(status);
  fields.priority = named(f.priority);
  fields.dueDate = jiraDateToEpochMs(f[options.dueDateField || JIRA_SYSTEM_DUE_DATE_FIELD]);

  return {
    id: issue.id,
    idReadable: issue.key,
    summary: str(f.summary) ?? '',
    resolved: done ? (timestampMs(f.resolutiondate) ?? timestampMs(f.updated) ?? RESOLVED_TIME_UNKNOWN) : null,
    fields,
    parentEpic: parentEpicOf(f, options),
    isEpic: isEpicType(f.issuetype as JiraIssueType | null | undefined),
    statusRole,
  };
}

/** The project key an issue key belongs to: `OPS_2-7` → `OPS_2`. */
export function jiraProjectKeyOf(issueKey: string): string {
  return issueKey.replace(/-\d+$/, '');
}

export function mapJiraIssueDetail(issue: JiraIssue, options: JiraMappingOptions = {}): IssueDetail {
  const project = (issue.fields?.project ?? null) as { id?: unknown; key?: unknown; name?: unknown } | null;
  const key = str(project?.key) ?? jiraProjectKeyOf(issue.key);
  return {
    ...mapJiraIssue(issue, options),
    project: { id: str(project?.id) ?? '', name: str(project?.name) ?? key, shortName: key },
  };
}

/**
 * The board's free-text search as JQL: text ~ "<query>", with JQL string
 * escaping so the query can never break out of the quoted string.
 */
export function jqlTextClause(query: string): string {
  const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ');
  return `text ~ "${escaped}"`;
}

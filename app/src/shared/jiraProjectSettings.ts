// Per-project Jira settings: the status mapping and the due-date field choice
// (VERM-31, proposal §3 "Blocked vs. deferred" and "Due date", risk B5).
//
// Jira workflows are per project, so a status name alone says nothing about
// what Vermilian should do with it. Every status resolves to a StatusRole:
//
//   1. the project's own mapping table, when it names that status;
//   2. otherwise Jira's status category — To Do → todo, In Progress →
//      inProgress, Done → done — which every Jira status carries.
//
// The table is what lets a project say "Impeded" means blocked, "On hold"
// means deferred, or "Closed — won't fix" is done. The categories cannot say
// blocked, waiting or deferred, which is the "small loss in precision" the
// proposal accepts when there is no mapping.
//
// The due date is the system `duedate` unless the project chooses a custom
// date field (some projects' create screens use a custom "Due Date" instead).
// dueDateFieldCandidates lists the choices from a project's createmeta or
// editmeta field metadata.
//
// Never hard-code a site's `customfield_` IDs or status names in public code
// (B5): they come from these settings, stored in the workspace document.
//
// Pure TypeScript: no Electron, no React.

import type { StatusRole } from './workspace';

export const STATUS_ROLES = ['todo', 'inProgress', 'waiting', 'blocked', 'deferred', 'done'] as const satisfies readonly StatusRole[];

export const JIRA_SYSTEM_DUE_DATE_FIELD = 'duedate';

export interface JiraProjectSettings {
  /** Jira status name → role. Statuses not named here fall back to their category. */
  statusRoles?: Record<string, StatusRole>;
  /** `duedate` (the default) or a custom date field id such as `customfield_10042`. */
  dueDateField?: string;
  /** The legacy Epic Link custom field id, read only when there is no Epic parent. */
  epicLinkField?: string;
}

/** Settings per Jira project key. */
export type JiraProjectSettingsMap = Record<string, JiraProjectSettings>;

const CUSTOM_FIELD_RE = /^customfield_\d{1,12}$/;
const MAX_STATUS_NAME = 255;

export function isJiraCustomFieldId(v: unknown): v is string {
  return typeof v === 'string' && CUSTOM_FIELD_RE.test(v);
}

export function isJiraDueDateField(v: unknown): v is string {
  return v === JIRA_SYSTEM_DUE_DATE_FIELD || isJiraCustomFieldId(v);
}

export function isStatusRole(v: unknown): v is StatusRole {
  return typeof v === 'string' && (STATUS_ROLES as readonly string[]).includes(v);
}

/** The role a Jira status category implies: `new`, `indeterminate` or `done`. */
export function categoryStatusRole(categoryKey: unknown): StatusRole | null {
  switch (categoryKey) {
    case 'new':
      return 'todo';
    case 'indeterminate':
      return 'inProgress';
    case 'done':
      return 'done';
    default:
      return null;
  }
}

/** A status as search/jql and GET /issue return it; every part optional. */
export interface JiraStatusValue {
  name?: unknown;
  statusCategory?: { key?: unknown } | null;
}

const statusKey = (name: string) => name.trim().toLowerCase();

/**
 * The status's role: the project's mapping first (exact name, then ignoring
 * case and surrounding spaces), then the status category. null only when the
 * status is absent or carries neither a mapped name nor a known category.
 */
export function jiraStatusRole(
  status: JiraStatusValue | null | undefined,
  statusRoles: Record<string, StatusRole> | undefined,
): StatusRole | null {
  if (!status) return null;
  const name = typeof status.name === 'string' ? status.name : '';
  if (name && statusRoles) {
    const exact = statusRoles[name];
    if (isStatusRole(exact)) return exact;
    const wanted = statusKey(name);
    for (const [mapped, role] of Object.entries(statusRoles)) {
      if (statusKey(mapped) === wanted && isStatusRole(role)) return role;
    }
  }
  return categoryStatusRole(status.statusCategory?.key);
}

export interface JiraProjectSettingsProblem {
  path: string; // relative to the settings object, e.g. `statusRoles["Impeded"]`
  message: string;
}

const recordPath = (path: string, key: string) => `${path}[${JSON.stringify(key)}]`;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every problem with `v` as one project's settings, or [] when it is valid. */
export function jiraProjectSettingsProblems(v: unknown): JiraProjectSettingsProblem[] {
  if (!isPlainObject(v)) return [{ path: '', message: 'must be an object.' }];
  const out: JiraProjectSettingsProblem[] = [];
  if (v.statusRoles !== undefined) {
    if (!isPlainObject(v.statusRoles)) {
      out.push({ path: 'statusRoles', message: 'statusRoles must be an object of status name → role.' });
    } else {
      const seen = new Map<string, string>();
      for (const [name, role] of Object.entries(v.statusRoles)) {
        const p = recordPath('statusRoles', name);
        if (name.trim() === '' || name.length > MAX_STATUS_NAME) {
          out.push({ path: p, message: `status names must be 1–${MAX_STATUS_NAME} characters.` });
        }
        if (!isStatusRole(role)) out.push({ path: p, message: `the role must be one of: ${STATUS_ROLES.join(', ')}.` });
        // Two spellings of one status would make the case-insensitive match
        // depend on key order.
        const k = statusKey(name);
        const first = seen.get(k);
        if (first !== undefined) out.push({ path: p, message: `duplicates ${JSON.stringify(first)} apart from case or spacing.` });
        else seen.set(k, name);
      }
    }
  }
  if (v.dueDateField !== undefined && !isJiraDueDateField(v.dueDateField)) {
    out.push({ path: 'dueDateField', message: 'dueDateField must be "duedate" or a custom field id such as customfield_10042.' });
  }
  if (v.epicLinkField !== undefined && !isJiraCustomFieldId(v.epicLinkField)) {
    out.push({ path: 'epicLinkField', message: 'epicLinkField must be a custom field id such as customfield_10014.' });
  }
  return out;
}

// ─── Due-date field choice ───────────────────────────────────────────────────

/** One field in createmeta / editmeta: `fields[id] = { name, schema }`. */
export interface JiraFieldMeta {
  name?: unknown;
  schema?: { type?: unknown; system?: unknown; custom?: unknown } | null;
}

export interface DueDateFieldCandidate {
  id: string;
  name: string;
  system: boolean;
}

/**
 * The fields a project could take its due date from: the system `duedate`
 * when the project has it, then every custom date or date-time field, by
 * name. Built from createmeta or editmeta, so it lists only fields that are
 * on the project's screens.
 */
export function dueDateFieldCandidates(fields: Record<string, JiraFieldMeta> | null | undefined): DueDateFieldCandidate[] {
  if (!fields) return [];
  const out: DueDateFieldCandidate[] = [];
  const system = fields[JIRA_SYSTEM_DUE_DATE_FIELD];
  if (system) out.push({ id: JIRA_SYSTEM_DUE_DATE_FIELD, name: typeof system.name === 'string' && system.name ? system.name : 'Due date', system: true });
  const custom: DueDateFieldCandidate[] = [];
  for (const [id, meta] of Object.entries(fields)) {
    if (!isJiraCustomFieldId(id) || !meta) continue;
    const type = meta.schema?.type;
    if (type !== 'date' && type !== 'datetime') continue;
    custom.push({ id, name: typeof meta.name === 'string' && meta.name ? meta.name : id, system: false });
  }
  custom.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...out, ...custom];
}

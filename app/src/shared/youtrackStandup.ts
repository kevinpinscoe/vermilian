// What each YouTrack Status value means to a stand-up, per project (VERM-114).
//
// Stand-ups used to query and group by a hard-coded list of status names. One
// of them ("Working on it") had been removed from the live bundle, and
// YouTrack rejects a whole query when one value is unknown, so every stand-up
// (and the Priority Desk Daily Review, which shares the read) failed. Now the
// values come only from each project's own Status field
// (shared/youtrackProjectFields.ts), and each value resolves to a StatusRole:
//
//   1. the workspace document's `youtrackProjects[<shortName>].statusRoles`
//      override for that value, when there is one;
//   2. otherwise a default derived from the project's configuration:
//      - a resolved value is `done`, except Wont do (also spelt Won't do),
//        which has no role and so never counts as an accomplishment. That is
//        the one agreed default exclusion (Kevin, VERM-114 review); any other
//        resolved value that closes an issue without completing it
//        (Duplicate, Obsolete, Rejected…) counts as done unless the project
//        maps it to a role with no stand-up group, such as `deferred`;
//      - an unresolved value is `inProgress`, `waiting` or `blocked` when its
//        name says so (In Progress, Working on it, Waiting…, Blocked…), and
//        `todo` otherwise.
//
// A stand-up reports three groups: done (role `done`), in progress (roles
// `inProgress` and `waiting`) and blocked (role `blocked`). The query and the
// displayed groups are built from the same mapping, so an issue can only be
// fetched for the group it is shown in.
//
// Nothing that is not one of the project's own values ever reaches the query.
// A project whose mapping leaves a group empty is named in a warning, and the
// groups that do have values are still reported.
//
// Pure TypeScript: no Electron, no React.

import type { StatusRole } from './workspace';
import { isStatusRole } from './jiraProjectSettings';
import { isYouTrackShortName } from './priority';
import { youtrackStatusField, type YouTrackFieldValue, type YouTrackProjectMetadata } from './youtrackProjectFields';

export type StandupGroup = 'done' | 'inProgress' | 'blocked';
export const STANDUP_GROUPS: readonly StandupGroup[] = ['done', 'inProgress', 'blocked'];
const GROUP_LABEL: Record<StandupGroup, string> = { done: 'done', inProgress: 'in progress', blocked: 'blocked' };

/** Per-project YouTrack settings in a workspace document, keyed by project short name. */
export interface YouTrackProjectSettings {
  /** Status value → role. Values not named here use the derived default. */
  statusRoles?: Record<string, StatusRole>;
}
export type YouTrackProjectSettingsMap = Record<string, YouTrackProjectSettings>;

const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');

// The resolved value excluded from accomplishments by default. Only Wont do
// was agreed; broadening this needs Kevin's approval (VERM-114 review), and
// a project can exclude anything else through its own overrides.
const NOT_COMPLETED = new Set(['wont do']);
const IN_PROGRESS = new Set(['in progress', 'working on it', 'doing', 'in development', 'in review']);
const BLOCKED = new Set(['blocked', 'impeded']);

/** The role a value has when the project names no override; null = not reported. */
export function defaultYouTrackStatusRole(value: Pick<YouTrackFieldValue, 'name' | 'isResolved'>): StatusRole | null {
  const n = norm(value.name);
  if (value.isResolved) return NOT_COMPLETED.has(n) ? null : 'done';
  if (IN_PROGRESS.has(n)) return 'inProgress';
  if (n.startsWith('waiting')) return 'waiting';
  if (BLOCKED.has(n)) return 'blocked';
  return 'todo';
}

/** The stand-up group a role reports in; null = not reported. */
export function standupGroupOfRole(role: StatusRole | null): StandupGroup | null {
  if (role === 'done') return 'done';
  if (role === 'inProgress' || role === 'waiting') return 'inProgress';
  if (role === 'blocked') return 'blocked';
  return null;
}

/** One project's part of a stand-up: its state field and which values report where. */
export interface StandupProjectPlan {
  shortName: string;
  statusField: string;
  /** Status value (exactly as the project names it) → group. Only reported values. */
  groups: Record<string, StandupGroup>;
}

/** One incomplete-mapping note: plain language, never a credential. */
export interface StandupPlanWarning {
  shortName: string;
  /** The group this leaves empty; null when the whole project (or one value) is affected. */
  group: StandupGroup | null;
  message: string;
}

export interface StandupPlan {
  projects: StandupProjectPlan[];
  warnings: StandupPlanWarning[];
}

export interface StandupProjectInput {
  shortName: string;
  /** null when the project's configuration could not be read. */
  metadata: YouTrackProjectMetadata | null;
}

/**
 * Build the stand-up plan from each project's own configuration and the
 * workspace's overrides. Pure: the same inputs always give the same plan.
 */
export function buildStandupPlan(
  inputs: readonly StandupProjectInput[],
  settings: YouTrackProjectSettingsMap | undefined,
): StandupPlan {
  const projects: StandupProjectPlan[] = [];
  const warnings: StandupPlanWarning[] = [];
  const warn = (shortName: string, group: StandupGroup | null, message: string) => warnings.push({ shortName, group, message });
  for (const { shortName, metadata } of inputs) {
    if (!metadata) {
      warn(shortName, null, `${shortName}: its field configuration could not be read, so it is left out of this stand-up.`);
      continue;
    }
    const field = youtrackStatusField(metadata);
    if (!field) {
      warn(shortName, null, `${shortName}: it has no Status field Vermilian can read, so it is left out of this stand-up.`);
      continue;
    }
    const overrides = settings?.[shortName]?.statusRoles ?? {};
    const known = new Set(field.values.map((v) => v.name));
    for (const name of Object.keys(overrides)) {
      if (!known.has(name)) {
        warn(shortName, null, `${shortName}: the status mapping names "${name}", which is not a value of its ${field.name} field, so that entry is ignored.`);
      }
    }
    const groups: Record<string, StandupGroup> = {};
    for (const v of field.values) {
      const override = overrides[v.name];
      const role = isStatusRole(override) ? override : defaultYouTrackStatusRole(v);
      const group = standupGroupOfRole(role);
      if (!group) continue;
      // YouTrack's query syntax has no escape for braces.
      if (/[{}]/.test(v.name)) {
        warn(shortName, null, `${shortName}: the ${field.name} value "${v.name}" contains a brace and cannot be queried, so it is skipped.`);
        continue;
      }
      groups[v.name] = group;
    }
    const present = new Set(Object.values(groups));
    for (const g of STANDUP_GROUPS) {
      if (!present.has(g)) {
        warn(shortName, g, `${shortName}: no ${field.name} value is mapped to ${GROUP_LABEL[g]}, so ${GROUP_LABEL[g]} issues from ${shortName} are not shown.`);
      }
    }
    if (present.size > 0) projects.push({ shortName, statusField: field.name, groups });
  }
  return { projects, warnings };
}

/**
 * The YouTrack search query for a plan: one clause per project, naming only
 * that project's own values, e.g.
 * `(project: {A} and {Status}: {Done},{In Progress}) or (project: {B} and {State}: {Fixed})`.
 * '' when no project has a reported value.
 */
export function buildStandupQuery(plan: Pick<StandupPlan, 'projects'>): string {
  return plan.projects
    .filter((p) => Object.keys(p.groups).length > 0)
    .map((p) => `(project: {${p.shortName}} and {${p.statusField}}: ${Object.keys(p.groups).map((v) => `{${v}}`).join(',')})`)
    .join(' or ');
}

/** The group an issue reports in, by its project and status value; null = not reported. */
export function standupGroupFor(plan: Pick<StandupPlan, 'projects'>, shortName: string, status: string | null | undefined): StandupGroup | null {
  if (!status) return null;
  return plan.projects.find((p) => p.shortName === shortName)?.groups[status] ?? null;
}

export interface YouTrackProjectSettingsProblem {
  path: string; // e.g. `["VERM"].statusRoles["Wont do"]`, relative to youtrackProjects
  message: string;
}

const recordPath = (key: string) => `[${JSON.stringify(key)}]`;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validation of a workspace document's `youtrackProjects` map; [] when valid. */
export function youtrackProjectSettingsProblems(v: unknown): YouTrackProjectSettingsProblem[] {
  if (!isPlainObject(v)) return [{ path: '', message: 'must be an object keyed by YouTrack project short name.' }];
  const problems: YouTrackProjectSettingsProblem[] = [];
  for (const [key, settings] of Object.entries(v)) {
    const p = recordPath(key);
    if (!isYouTrackShortName(key)) problems.push({ path: p, message: 'must be keyed by a YouTrack project short name, e.g. VERM.' });
    if (!isPlainObject(settings)) {
      problems.push({ path: p, message: 'must be an object.' });
      continue;
    }
    for (const k of Object.keys(settings)) {
      if (k !== 'statusRoles') problems.push({ path: `${p}.${k}`, message: 'is not a known setting.' });
    }
    if (settings.statusRoles === undefined) continue;
    if (!isPlainObject(settings.statusRoles)) {
      problems.push({ path: `${p}.statusRoles`, message: 'must be an object of status name to role.' });
      continue;
    }
    for (const [name, role] of Object.entries(settings.statusRoles)) {
      const rp = `${p}.statusRoles${recordPath(name)}`;
      if (!name.trim() || name.length > 255) problems.push({ path: rp, message: 'must name a status of at most 255 characters.' });
      if (!isStatusRole(role)) problems.push({ path: rp, message: 'must be one of todo, inProgress, waiting, blocked, deferred, done.' });
    }
  }
  return problems;
}

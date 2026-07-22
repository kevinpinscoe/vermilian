// Single source of truth for every YouTrack custom field Vermilian knows how
// to read, write, display as a board column, or offer on the create-task
// form. Every other site (BoardIssueFields, ALL_COLUMN_FIELDS/COLUMN_LABELS,
// ADVANCE_ORDER, FormState, extractFields, createIssue, patchIssue) derives
// from FIELD_DEFS instead of independently declaring the same field list.
// See spec/features/field-registry.md.

export type FieldKey =
  | 'status'
  | 'priority'
  | 'category'
  | 'dueDate'
  | 'ticket'
  | 'ticketLink'
  | 'relatedLink'
  | 'notes'
  | 'dateTimeEntered'
  | 'assignee'
  | 'ghosttyTabName'
  | 'repoUrl'
  | 'workingBranch'
  | 'trackingFileUrl'
  | 'todoFileUrl'
  | 'projectHealth'
  | 'progressPercent'
  | 'nextStatusDue'
  | 'reportingCadence'
  | 'baseBranch'
  | 'pullRequestUrl'
  | 'artifactUrl'
  | 'lastReportedCommit';

export type FieldWire = 'state' | 'enum' | 'date' | 'text' | 'user' | 'integer';
export type FieldEditor = 'select' | 'date' | 'text' | 'link' | 'readonly' | 'number';

export interface FieldDef {
  key: FieldKey;
  ytName: string;
  $type: string;
  wire: FieldWire; // drives toYouTrackValue and extraction parsing
  label: string;
  editor?: FieldEditor; // undefined only for assignee — no UI surface
  options?: readonly string[]; // only for editor: 'select'
  column: boolean; // member of ALL_COLUMN_FIELDS
  creatable: boolean; // included in CreateIssuePayload / TaskForm
  patchable: boolean; // metadata only — patchIssue does not enforce this
  detailOrder?: number; // position in TaskDetailPanel; undefined = not rendered there
  validate?: (value: string) => string | null; // returns an error message, or null if valid
}

export function isValidUrl(s: string): string | null {
  return /^https?:\/\//i.test(s) ? null : 'Must be a valid URL.';
}

const STATUS_VALUES = [
  'To do', 'In Progress', 'Working on it', 'Waiting for IT', 'BLOCKED',
  'Waiting for approval', 'Waiting for customer', 'Waiting on external resource', 'Done',
] as const;

const PRIORITY_VALUES = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor'] as const;

// Matches the live "Category" StateBundle (id 158-8), shared across every
// project — verified directly against the YouTrack API 2026-07-22. This is
// an area/domain tag, not an issue-type classification; the old
// INBOX/BUG/FEATURE/TASK list didn't correspond to any real bundle value
// except INBOX, so task creation failed with YouTrack's
// "An X-type entity with the specified name ({1}) was not found" error.
const CATEGORY_VALUES = [
  'PROJECT', 'OPS', 'COMPANY', 'SERVICE', 'PRODUCTIVITY', 'INBOX', 'ADMIN',
  'RELEASE', 'FINOPS', 'SECURITY', 'INGEST', 'HACKATHON', 'Playbook',
] as const;

const PROJECT_HEALTH_VALUES = ['Green', 'Yellow', 'Red'] as const;

const REPORTING_CADENCE_VALUES = ['Daily', 'Sprint', 'Monthly', 'Annual', 'On demand'] as const;

export const FIELD_DEFS = {
  status: {
    key: 'status', ytName: 'Status', $type: 'StateIssueCustomField', wire: 'state',
    label: 'Status', editor: 'select', options: STATUS_VALUES,
    column: true, creatable: true, patchable: true, detailOrder: 1,
  },
  priority: {
    key: 'priority', ytName: 'Priority', $type: 'SingleEnumIssueCustomField', wire: 'enum',
    label: 'Priority', editor: 'select', options: PRIORITY_VALUES,
    column: true, creatable: true, patchable: true, detailOrder: 2,
  },
  category: {
    // $type corrected from SingleEnumIssueCustomField — the live field is a
    // StateIssueCustomField (BUG-005; writes were sending the wrong shape).
    key: 'category', ytName: 'Category', $type: 'StateIssueCustomField', wire: 'state',
    label: 'Category', editor: 'select', options: CATEGORY_VALUES,
    column: true, creatable: true, patchable: true, detailOrder: 3,
  },
  dueDate: {
    key: 'dueDate', ytName: 'Due Date', $type: 'DateIssueCustomField', wire: 'date',
    label: 'Due Date', editor: 'date',
    column: true, creatable: true, patchable: true, detailOrder: 4,
  },
  ticket: {
    key: 'ticket', ytName: 'Ticket', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Ticket #', editor: 'text',
    column: true, creatable: true, patchable: true, detailOrder: 5,
  },
  ticketLink: {
    key: 'ticketLink', ytName: 'Ticket link', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Ticket link', editor: 'link', validate: isValidUrl,
    column: true, creatable: true, patchable: true, detailOrder: 6,
  },
  relatedLink: {
    // Renamed from trackingLink: the live YouTrack field "Tracking link" was
    // renamed to "Related link" to resolve a naming collision with a new
    // "Tracking file URL" field (see the sibling youtrack.kevininscoe.com
    // repo's PLAN.md). Key, ytName, and label all updated together.
    key: 'relatedLink', ytName: 'Related link', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Related link', editor: 'link', validate: isValidUrl,
    column: true, creatable: true, patchable: true, detailOrder: 7,
  },
  notes: {
    // $type corrected from TextIssueCustomField — the live field is a
    // SimpleIssueCustomField (BUG-005; writes were sending the wrong shape).
    key: 'notes', ytName: 'Notes', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Notes', editor: 'text',
    column: true, creatable: true, patchable: true, detailOrder: 8,
  },
  dateTimeEntered: {
    key: 'dateTimeEntered', ytName: 'Date time entered', $type: 'DateIssueCustomField', wire: 'date',
    label: 'Date entered', editor: 'readonly',
    column: true, creatable: false, patchable: false, detailOrder: 9,
  },
  assignee: {
    // Previously absent from the field map entirely, so patchIssue('assignee', …)
    // threw "Unknown field". Data-layer completeness only — no column or
    // detailOrder, so no new UI surface is added by this fix.
    key: 'assignee', ytName: 'Assignee', $type: 'SingleUserIssueCustomField', wire: 'user',
    label: 'Assignee',
    column: false, creatable: false, patchable: true,
  },
  // The 13 fields below were added to YouTrack (all 24 active projects) in the
  // sibling youtrack.kevininscoe.com repo's PLAN.md, Plan B. Shapes confirmed
  // against a live populated issue (KEVUPD-1), not guessed. All hidden by
  // default (DEFAULT_COLUMNS, boardConfig.ts); only repoUrl is creatable.
  ghosttyTabName: {
    key: 'ghosttyTabName', ytName: 'Ghostty tab name', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Ghostty tab name', editor: 'text',
    column: true, creatable: false, patchable: true, detailOrder: 10,
  },
  repoUrl: {
    key: 'repoUrl', ytName: 'Repo URL', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Repo URL', editor: 'link', validate: isValidUrl,
    column: true, creatable: true, patchable: true, detailOrder: 11,
  },
  workingBranch: {
    key: 'workingBranch', ytName: 'Working branch', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Working branch', editor: 'text',
    column: true, creatable: false, patchable: true, detailOrder: 12,
  },
  trackingFileUrl: {
    key: 'trackingFileUrl', ytName: 'Tracking file URL', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Tracking file URL', editor: 'link', validate: isValidUrl,
    column: true, creatable: false, patchable: true, detailOrder: 13,
  },
  todoFileUrl: {
    key: 'todoFileUrl', ytName: 'TODO file URL', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'TODO file URL', editor: 'link', validate: isValidUrl,
    column: true, creatable: false, patchable: true, detailOrder: 14,
  },
  projectHealth: {
    key: 'projectHealth', ytName: 'Project health', $type: 'SingleEnumIssueCustomField', wire: 'enum',
    label: 'Project health', editor: 'select', options: PROJECT_HEALTH_VALUES,
    column: true, creatable: false, patchable: true, detailOrder: 15,
  },
  progressPercent: {
    // Integer value on the wire (SimpleIssueCustomField, raw JSON number — same
    // $type as the free-text fields, but the value shape is numeric, not string).
    key: 'progressPercent', ytName: 'Progress percent', $type: 'SimpleIssueCustomField', wire: 'integer',
    label: 'Progress percent', editor: 'number',
    column: true, creatable: false, patchable: true, detailOrder: 16,
  },
  nextStatusDue: {
    key: 'nextStatusDue', ytName: 'Next status due', $type: 'DateIssueCustomField', wire: 'date',
    label: 'Next status due', editor: 'date',
    column: true, creatable: false, patchable: true, detailOrder: 17,
  },
  reportingCadence: {
    key: 'reportingCadence', ytName: 'Reporting cadence', $type: 'SingleEnumIssueCustomField', wire: 'enum',
    label: 'Reporting cadence', editor: 'select', options: REPORTING_CADENCE_VALUES,
    column: true, creatable: false, patchable: true, detailOrder: 18,
  },
  baseBranch: {
    key: 'baseBranch', ytName: 'Base branch', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Base branch', editor: 'text',
    column: true, creatable: false, patchable: true, detailOrder: 19,
  },
  pullRequestUrl: {
    key: 'pullRequestUrl', ytName: 'Pull request URL', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Pull request URL', editor: 'link', validate: isValidUrl,
    column: true, creatable: false, patchable: true, detailOrder: 20,
  },
  artifactUrl: {
    key: 'artifactUrl', ytName: 'Artifact URL', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Artifact URL', editor: 'link', validate: isValidUrl,
    column: true, creatable: false, patchable: true, detailOrder: 21,
  },
  lastReportedCommit: {
    key: 'lastReportedCommit', ytName: 'Last reported commit', $type: 'SimpleIssueCustomField', wire: 'text',
    label: 'Last reported commit', editor: 'text',
    column: true, creatable: false, patchable: true, detailOrder: 22,
  },
} as const satisfies Record<FieldKey, FieldDef>;

export const FIELD_KEYS = Object.keys(FIELD_DEFS) as FieldKey[];

// FIELD_DEFS's literal (as const) type means each entry only carries the
// optional properties it was written with, so indexing by a dynamic FieldKey
// produces a union TS won't let you read optional properties from directly
// (they don't exist on every member). getFieldDef widens the result to the
// general FieldDef shape for that.
export function getFieldDef(key: FieldKey): FieldDef {
  return FIELD_DEFS[key];
}

export const CREATABLE_FIELD_DEFS: FieldDef[] = FIELD_KEYS
  .map(getFieldDef)
  .filter((d) => d.creatable);

type WireOf<K extends FieldKey> = (typeof FIELD_DEFS)[K]['wire'];
type ValueOf<W> = W extends 'date' | 'integer' ? number | null : string | null;

/** Per-issue custom-field value shape, keyed by FieldKey, derived from FIELD_DEFS's wire kinds. */
export type BoardIssueFields = { [K in FieldKey]: ValueOf<WireOf<K>> };

/** FieldKeys whose FIELD_DEFS entry has column: true — used to derive ColumnField in boardConfig.ts. */
export type ColumnFieldKey = {
  [K in FieldKey]: (typeof FIELD_DEFS)[K]['column'] extends true ? K : never;
}[FieldKey];

/** Convert a Vermilian field value into the shape YouTrack expects on write. */
export function toYouTrackValue(def: FieldDef, value: string | number | null): unknown {
  switch (def.wire) {
    case 'state':
    case 'enum':
      return value !== null ? { name: value } : null;
    case 'user':
      return value !== null ? { login: value } : null;
    case 'integer':
      return value; // explicit — was coincidentally correct via default, now intentional
    case 'date':
    case 'text':
    default:
      return value;
  }
}

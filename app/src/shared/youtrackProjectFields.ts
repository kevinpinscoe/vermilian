// A YouTrack project's own field configuration (VERM-114, generalising the
// VERM-92 Priority read).
//
// One request per project — `/api/admin/projects/{id}/customFields` with the
// fields below — answers every question Vermilian asks about a project's
// configuration: the Priority order the Tracker priority sort uses, and the
// Status values (with whether each one resolves the issue) that the stand-up
// query and its grouping are built from. Nothing is assumed about any
// project's values: what this reads is what the project has.
//
// The same reader is meant for task creation (VERM-115): each field's values,
// whether it may be empty, and its configured default are all here.
//
// Pure TypeScript: no Electron, no React.

import { youtrackPriorityOrder, type YouTrackProjectCustomField } from './priority';

/** The `fields=` selection for `/api/admin/projects/{id}/customFields`. */
export const YOUTRACK_PROJECT_FIELDS_SELECTION =
  'field(name,fieldType(id)),$type,canBeEmpty,defaultValues(name),bundle(values(name,isResolved,ordinal,archived))';

/** One project custom field as the request above returns it; every part optional. */
export interface RawYouTrackProjectField extends YouTrackProjectCustomField {
  field?: { name?: unknown; fieldType?: { id?: unknown } | null } | null;
  $type?: unknown;
  canBeEmpty?: unknown;
  defaultValues?: Array<{ name?: unknown } | null> | null;
  bundle?: {
    values?: Array<{ name?: unknown; ordinal?: unknown; isResolved?: unknown; archived?: unknown } | null> | null;
  } | null;
}

export interface YouTrackFieldValue {
  name: string;
  /** State fields only: whether this value resolves the issue. */
  isResolved: boolean;
  archived: boolean;
}

export interface YouTrackProjectField {
  name: string;
  /** e.g. `StateProjectCustomField`, `EnumProjectCustomField`. */
  type: string;
  /** The field's value type, e.g. `date`, `date and time`, `string`, `state[1]`; '' when not returned. */
  fieldType: string;
  canBeEmpty: boolean;
  /** The project's configured default value names, in order. */
  defaults: string[];
  /** Bundle values in bundle order (by ordinal), de-duplicated. */
  values: YouTrackFieldValue[];
}

export interface YouTrackProjectMetadata {
  fields: YouTrackProjectField[];
  /** Priority values, most urgent first (VERM-92); [] when there is no Priority field. */
  priorityOrder: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Parse the customFields response. Malformed entries are dropped, never guessed. */
export function parseYouTrackProjectFields(raw: unknown): YouTrackProjectMetadata {
  const list = Array.isArray(raw) ? (raw as Array<RawYouTrackProjectField | null>) : [];
  const fields: YouTrackProjectField[] = [];
  for (const f of list) {
    const name = str(f?.field?.name);
    if (!f || !name) continue;
    const rawValues = Array.isArray(f.bundle?.values) ? f.bundle.values : [];
    const ranked = rawValues
      .map((v, i) => ({
        name: str(v?.name),
        isResolved: v?.isResolved === true,
        archived: v?.archived === true,
        ordinal: typeof v?.ordinal === 'number' ? v.ordinal : Number.MAX_SAFE_INTEGER,
        i,
      }))
      .filter((v) => v.name)
      .sort((a, b) => a.ordinal - b.ordinal || a.i - b.i);
    const values: YouTrackFieldValue[] = [];
    for (const v of ranked) {
      if (!values.some((x) => x.name === v.name)) values.push({ name: v.name, isResolved: v.isResolved, archived: v.archived });
    }
    const defaults = (Array.isArray(f.defaultValues) ? f.defaultValues : []).map((d) => str(d?.name)).filter(Boolean);
    fields.push({ name, type: str(f.$type), fieldType: str(f.field?.fieldType?.id), canBeEmpty: f.canBeEmpty === true, defaults, values });
  }
  return { fields, priorityOrder: youtrackPriorityOrder(list) ?? [] };
}

/** The automatic creation timestamp's field (VERM-115). */
export const DATE_TIME_ENTERED_FIELD = 'Date time entered';

/**
 * Whether the project defines `Date time entered` as a field that accepts the
 * automatic timestamp (epoch milliseconds): a `date` or `date and time` field.
 * Absent, or any other type, means the timestamp is not sent (VERM-115).
 */
export function acceptsDateTimeEntered(meta: YouTrackProjectMetadata): boolean {
  const f = meta.fields.find((x) => x.name === DATE_TIME_ENTERED_FIELD);
  return Boolean(f && (f.fieldType === 'date' || f.fieldType === 'date and time'));
}

/**
 * The project's state field for stand-ups: the field named `Status` when it is
 * a state field, otherwise the project's only state field. null when there is
 * none, or several and none is called Status — the caller then says so rather
 * than picking one.
 */
export function youtrackStatusField(meta: YouTrackProjectMetadata): YouTrackProjectField | null {
  const states = meta.fields.filter((f) => f.type === 'StateProjectCustomField');
  return states.find((f) => f.name === 'Status') ?? (states.length === 1 ? states[0] : null);
}

// The values a YouTrack project offers for each select field Vermilian shows
// (VERM-117): the Kanban chip editor, board grouping and filters, the Priority
// Desk, and the task detail dropdowns all read these instead of fixed lists.
//
// Derived from VERM-114's per-project metadata reader, so nothing is assumed
// about any project: two projects may offer different Status, Priority or
// Affected host values, and the same Status name may resolve an issue in one
// project and not in another.
//
// Pure TypeScript: no Electron, no React.

import { FIELD_KEYS, getFieldDef, type FieldKey } from './fields';
import type { YouTrackProjectMetadata } from './youtrackProjectFields';

/** The select fields: every field whose editor is a dropdown. */
export const SELECT_FIELD_KEYS: readonly FieldKey[] = FIELD_KEYS.filter((k) => getFieldDef(k).editor === 'select');

export interface ProjectFieldChoices {
  /** Whether the project has this field at all. */
  present: boolean;
  /** Active values, in the project's bundle order — what may be chosen. */
  values: string[];
  /** Archived values: still shown when an issue holds one, never offered. */
  archived: string[];
  /** State fields: the values (active or archived) that resolve an issue. */
  resolved: string[];
}

export interface ProjectFieldValues {
  fields: Partial<Record<FieldKey, ProjectFieldChoices>>;
  /** Priority values, most urgent first (VERM-92); [] when there is none. */
  priorityOrder: string[];
}

const ABSENT: ProjectFieldChoices = { present: false, values: [], archived: [], resolved: [] };

export function projectFieldValuesFromMetadata(meta: YouTrackProjectMetadata): ProjectFieldValues {
  const fields: Partial<Record<FieldKey, ProjectFieldChoices>> = {};
  for (const key of SELECT_FIELD_KEYS) {
    const f = meta.fields.find((x) => x.name === getFieldDef(key).ytName);
    fields[key] = f
      ? {
          present: true,
          values: f.values.filter((v) => !v.archived).map((v) => v.name),
          archived: f.values.filter((v) => v.archived).map((v) => v.name),
          resolved: f.values.filter((v) => v.isResolved).map((v) => v.name),
        }
      : { ...ABSENT };
  }
  return { fields, priorityOrder: [...meta.priorityOrder] };
}

/** One field's choices for a project; absent when unknown or not on the project. */
export function fieldChoices(values: ProjectFieldValues | null | undefined, key: FieldKey): ProjectFieldChoices {
  return values?.fields[key] ?? ABSENT;
}

/**
 * What a dropdown offers for an issue's current value: the project's active
 * values, with the current value first when it is not one of them (archived,
 * or no longer in the bundle), so opening an issue never loses its saved value.
 */
export function dropdownOptions(choices: ProjectFieldChoices, current: string | null | undefined): { options: string[]; currentInactive: boolean } {
  const options = [...choices.values];
  const currentInactive = Boolean(current) && !options.includes(current as string);
  if (currentInactive) options.unshift(current as string);
  return { options, currentInactive };
}

/** Whether `status` resolves an issue in this project. */
export function isResolvedStatus(values: ProjectFieldValues | null | undefined, status: string | null | undefined): boolean {
  return Boolean(status) && fieldChoices(values, 'status').resolved.includes(status as string);
}

/**
 * One display order across several projects: each project's values in its own
 * bundle order, merged in first-seen order, projects taken in the order given.
 */
export function mergedValueOrder(perProject: Iterable<ProjectFieldValues | null | undefined>, key: FieldKey): string[] {
  const out: string[] = [];
  for (const v of perProject) {
    const c = fieldChoices(v, key);
    for (const name of [...c.values, ...c.archived]) if (!out.includes(name)) out.push(name);
  }
  return out;
}

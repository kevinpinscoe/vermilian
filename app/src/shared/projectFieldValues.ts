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
  /** Whether the project lets the field be cleared; false for a required field. */
  canBeEmpty: boolean;
}

export interface ProjectFieldValues {
  fields: Partial<Record<FieldKey, ProjectFieldChoices>>;
  /** Priority values, most urgent first (VERM-92); [] when there is none. */
  priorityOrder: string[];
}

const ABSENT: ProjectFieldChoices = { present: false, values: [], archived: [], resolved: [], canBeEmpty: false };

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
          canBeEmpty: f.canBeEmpty,
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

export type SelectEditorMode = 'editable' | 'loading' | 'error' | 'absent';

export interface SelectEditorState {
  mode: SelectEditorMode;
  /** What may be chosen (editable only): the current value first when it is inactive. */
  options: string[];
  /** The current value is archived or no longer in the project: shown, never re-sent. */
  currentInactive: boolean;
  /** The current value is one of the project's archived values. */
  currentArchived: boolean;
  /** The field may be cleared — only when the project allows it to be empty. */
  clearable: boolean;
}

/**
 * How a dropdown editor behaves for one field (VERM-117 review): editable only
 * when the project's values are known, the latest read succeeded, and no
 * re-read of that project is in flight — cached choices may be about to change,
 * so editing holds until the read finishes (for that project only). A read
 * error disables editing even if earlier choices are cached — they may include
 * a value the project has since retired — and stays until a read succeeds; the
 * current value stays visible throughout. A required field is never offered a
 * way to clear it.
 */
export function selectEditorState(
  values: ProjectFieldValues | null | undefined,
  readError: string | null | undefined,
  key: FieldKey,
  current: string | null | undefined,
  /** This project's values are being re-read: hold editing until the read finishes. */
  refreshing = false,
): SelectEditorState {
  const none = { options: [] as string[], currentInactive: false, currentArchived: false, clearable: false };
  if (readError) return { mode: 'error', ...none };
  if (!values || refreshing) return { mode: 'loading', ...none };
  const choices = fieldChoices(values, key);
  if (!choices.present) return { mode: 'absent', ...none };
  const { options, currentInactive } = dropdownOptions(choices, current);
  const currentArchived = Boolean(current) && choices.archived.includes(current as string);
  return { mode: 'editable', options, currentInactive, currentArchived, clearable: choices.canBeEmpty };
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

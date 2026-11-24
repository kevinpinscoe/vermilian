// The values task creation may offer and send, per project (VERM-115).
//
// Nothing here is a fixed list. Status, Priority and Category options come
// from the selected project's own field configuration, read by VERM-114's
// metadata reader (`youtrackProjectFields.ts`): its active (non-archived)
// values and its configured default. A field the project does not have is
// marked absent, and a value outside the project's options is never sent.
//
// Pure TypeScript: no Electron, no React. Used by both processes — the
// renderer to fill the form, the main process to recheck before creating.

import type { YouTrackProjectMetadata } from './youtrackProjectFields';

/** The select fields offered on the create form. */
export type CreateFieldKey = 'status' | 'priority' | 'category';

export const CREATE_FIELD_KEYS: readonly CreateFieldKey[] = ['status', 'priority', 'category'];

/** The YouTrack field each key reads, and the label the form shows. */
export const CREATE_FIELD_NAMES: Record<CreateFieldKey, string> = {
  status: 'Status',
  priority: 'Priority',
  category: 'Category',
};

export interface CreateFieldOption {
  /** Whether the project has this field at all. */
  present: boolean;
  /** Active values, in the project's bundle order. */
  values: string[];
  /** The project's configured default, when it is one of `values`; else null. */
  defaultValue: string | null;
  canBeEmpty: boolean;
}

export type CreateFieldOptions = Record<CreateFieldKey, CreateFieldOption>;

const ABSENT: CreateFieldOption = { present: false, values: [], defaultValue: null, canBeEmpty: true };

/** Derive the create options from one project's metadata. */
export function createFieldOptionsFromMetadata(meta: YouTrackProjectMetadata): CreateFieldOptions {
  const out = {} as CreateFieldOptions;
  for (const key of CREATE_FIELD_KEYS) {
    const field = meta.fields.find((f) => f.name === CREATE_FIELD_NAMES[key]);
    if (!field) {
      out[key] = { ...ABSENT, values: [] };
      continue;
    }
    const values = field.values.filter((v) => !v.archived).map((v) => v.name);
    const defaultValue = field.defaults.find((d) => values.includes(d)) ?? null;
    out[key] = { present: true, values, defaultValue, canBeEmpty: field.canBeEmpty };
  }
  return out;
}

/** Whether `value` may be sent for `key`: empty, or one of the project's values. */
export function isAllowedCreateValue(options: CreateFieldOptions, key: CreateFieldKey, value: string | null | undefined): boolean {
  if (!value) return true;
  const opt = options[key];
  return opt.present && opt.values.includes(value);
}

export interface RejectedCreateValue {
  key: CreateFieldKey;
  /** The YouTrack field name, e.g. `Status`. */
  field: string;
  value: string;
}

/** Every submitted value the project does not offer. */
export function invalidCreateValues(
  options: CreateFieldOptions,
  values: Partial<Record<CreateFieldKey, string | null>>,
): RejectedCreateValue[] {
  const out: RejectedCreateValue[] = [];
  for (const key of CREATE_FIELD_KEYS) {
    const value = values[key];
    if (value && !isAllowedCreateValue(options, key, value)) out.push({ key, field: CREATE_FIELD_NAMES[key], value });
  }
  return out;
}

/** One line naming a value the project does not offer. */
export function rejectedValueMessage(r: Pick<RejectedCreateValue, 'field' | 'value'>, projectName?: string): string {
  const where = projectName ? `in ${projectName}` : 'in this project';
  return `${r.field} "${r.value}" is not a value ${where}.`;
}

/**
 * Clear AI suggestions the project does not offer (VERM-115). Returns the
 * cleaned values and what was cleared, so the review form can flag each one.
 */
export function sanitizeCreateSuggestions<T extends Partial<Record<CreateFieldKey, string | null>>>(
  fields: T,
  options: CreateFieldOptions,
): { fields: T; cleared: RejectedCreateValue[] } {
  const cleared = invalidCreateValues(options, fields);
  const next = { ...fields };
  for (const c of cleared) (next as Record<string, string | null>)[c.key] = null;
  return { fields: next, cleared };
}

// ─── Server rejections ──────────────────────────────────────────────────────
//
// YouTrack refuses an unknown enum/state value with a template whose second
// placeholder it never fills: "An Open-type entity with the specified name
// ({1}) was not found" (recorded 2026-11-24, VERM-111 Claude check 2). Which
// value it means is not in the text; the word in the first placeholder may be
// the refused value ("Open" in that recording) but that is unconfirmed, so it
// is only trusted when it equals a value that was actually sent.

const NOT_FOUND = /An?\s+(.+?)-type entity with the specified name \(\{1\}\) was not found/i;

export function isUnfilledEntityNotFound(message: string): boolean {
  return NOT_FOUND.test(message) || /\(\{1\}\)/.test(message);
}

export interface ExplainedCreateError {
  message: string;
  rejected: RejectedCreateValue[];
  /** True when the cause could not be pinned to a field; offer to refresh the options. */
  ambiguous: boolean;
}

/**
 * Turn a create failure into something the user can act on: name the field and
 * value whenever the response or a fresh read of the project's options
 * identifies them; otherwise say plainly that YouTrack did not say which.
 * Messages that are not YouTrack's unfilled template pass through unchanged.
 */
export function explainCreateError(
  message: string,
  sent: Partial<Record<CreateFieldKey, string | null>>,
  freshOptions: CreateFieldOptions | null,
): ExplainedCreateError {
  if (!isUnfilledEntityNotFound(message)) return { message, rejected: [], ambiguous: false };

  // A fresh read of the project shows which sent value is no longer offered.
  if (freshOptions) {
    const rejected = invalidCreateValues(freshOptions, sent);
    if (rejected.length > 0) {
      return { message: `YouTrack refused ${rejected.map((r) => `${r.field} "${r.value}"`).join(' and ')}: not a value in this project.`, rejected, ambiguous: false };
    }
  }

  // The template's first placeholder, trusted only if it is a value we sent.
  const named = NOT_FOUND.exec(message)?.[1]?.trim();
  if (named) {
    const matches = CREATE_FIELD_KEYS.filter((k) => sent[k] === named);
    if (matches.length === 1) {
      const key = matches[0];
      const r = { key, field: CREATE_FIELD_NAMES[key], value: named };
      return { message: `YouTrack refused ${r.field} "${r.value}": not a value in this project.`, rejected: [r], ambiguous: false };
    }
  }

  return {
    message:
      'YouTrack refused one of the values sent but did not say which field. ' +
      "The project's options may have changed. Refresh the project options and try again.",
    rejected: [],
    ambiguous: true,
  };
}

// Applying one project's create options to the create form (VERM-115).
//
// Pure: no React. The form never offers or keeps a value the selected project
// does not have. Each untouched field takes the project's configured default,
// or stays empty so YouTrack applies its own; a value the project lacks is
// cleared and flagged with a line saying why.

import {
  CREATE_FIELD_KEYS,
  CREATE_FIELD_NAMES,
  type CreateFieldKey,
  type CreateFieldOptions,
} from '../../../shared/createFieldOptions';

export type FieldFlags = Partial<Record<CreateFieldKey, string>>;

export interface ApplyResult<F> {
  form: F;
  flags: FieldFlags;
  /** Category was set to INBOX because the project is an Inbox project. */
  inboxApplied: boolean;
}

export function clearedFlag(key: CreateFieldKey, value: string, fromAi: boolean): string {
  const field = CREATE_FIELD_NAMES[key];
  return fromAi
    ? `AI suggested ${field} "${value}", which this project does not offer. Cleared.`
    : `${field} "${value}" is not offered by this project. Cleared.`;
}

/**
 * The form after `options` (for `form.projectId`) are applied.
 *
 * - `touched`: fields whose value the user (or the AI suggestion) chose; they
 *   keep it when it is valid, and are never overwritten with a default.
 * - `fromAi`: fields whose current value came from the AI, for the flag text.
 * - `inboxProject`: Category becomes INBOX when untouched, empty and offered.
 */
export function applyCreateFieldOptions<F extends Record<CreateFieldKey, string>>(
  form: F,
  options: CreateFieldOptions,
  touched: ReadonlySet<CreateFieldKey>,
  fromAi: ReadonlySet<CreateFieldKey> = new Set(),
  inboxProject = false,
): ApplyResult<F> {
  const next = { ...form };
  const flags: FieldFlags = {};
  for (const key of CREATE_FIELD_KEYS) {
    const opt = options[key];
    const value = next[key];
    // Untouched: always this project's default (a previous project's default
    // is not a choice anyone made, so it is replaced without a flag).
    if (!touched.has(key)) {
      (next as Record<CreateFieldKey, string>)[key] = opt.defaultValue ?? '';
      continue;
    }
    if (value && !(opt.present && opt.values.includes(value))) {
      (next as Record<CreateFieldKey, string>)[key] = '';
      flags[key] = opt.present ? clearedFlag(key, value, fromAi.has(key)) : `This project has no ${CREATE_FIELD_NAMES[key]} field. "${value}" was cleared.`;
    }
  }
  let inboxApplied = false;
  if (inboxProject && !touched.has('category') && !next.category && options.category.present && options.category.values.includes('INBOX')) {
    (next as Record<CreateFieldKey, string>).category = 'INBOX';
    inboxApplied = true;
  }
  return { form: next, flags, inboxApplied };
}

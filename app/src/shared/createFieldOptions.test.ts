import { describe, expect, it } from 'vitest';
import {
  createFieldOptionsFromMetadata,
  explainCreateError,
  invalidCreateValues,
  isAllowedCreateValue,
  sanitizeCreateSuggestions,
  type CreateFieldOptions,
} from './createFieldOptions';
import { parseYouTrackProjectFields } from './youtrackProjectFields';

/** One project's raw customFields response, as VERM-114's reader receives it. */
function meta(fields: Array<{ name: string; type?: string; values: Array<string | { name: string; archived?: boolean }>; defaults?: string[]; canBeEmpty?: boolean }>) {
  return parseYouTrackProjectFields(
    fields.map((f) => ({
      field: { name: f.name },
      $type: f.type ?? 'StateProjectCustomField',
      canBeEmpty: f.canBeEmpty ?? true,
      defaultValues: (f.defaults ?? []).map((name) => ({ name })),
      bundle: { values: f.values.map((v, ordinal) => (typeof v === 'string' ? { name: v, ordinal } : { ...v, ordinal })) },
    })),
  );
}

// A project whose workflow has no "To do" at all, and a configured default.
const TRIAGE = createFieldOptionsFromMetadata(
  meta([
    { name: 'Status', values: ['Triage', 'Doing', { name: 'Parked', archived: true }, 'Shipped'], defaults: ['Triage'], canBeEmpty: false },
    { name: 'Priority', type: 'EnumProjectCustomField', values: ['P1', 'P2', 'P3'], defaults: ['P2'] },
  ]),
);

describe('createFieldOptionsFromMetadata', () => {
  it("takes the project's active values in bundle order and its configured default", () => {
    expect(TRIAGE.status).toEqual({ present: true, values: ['Triage', 'Doing', 'Shipped'], defaultValue: 'Triage', canBeEmpty: false });
    expect(TRIAGE.priority.defaultValue).toBe('P2');
  });

  it('marks a field the project does not have as absent', () => {
    expect(TRIAGE.category).toEqual({ present: false, values: [], defaultValue: null, canBeEmpty: true });
  });

  it('never assumes a default: none configured, or one no longer offered, is null', () => {
    const o = createFieldOptionsFromMetadata(meta([
      { name: 'Status', values: ['A', 'B'] },
      { name: 'Category', values: ['X', { name: 'Old', archived: true }], defaults: ['Old'] },
    ]));
    expect(o.status.defaultValue).toBeNull();
    expect(o.category.defaultValue).toBeNull();
  });
});

describe('value checks', () => {
  it('allows empty values and the project values only', () => {
    expect(isAllowedCreateValue(TRIAGE, 'status', '')).toBe(true);
    expect(isAllowedCreateValue(TRIAGE, 'status', null)).toBe(true);
    expect(isAllowedCreateValue(TRIAGE, 'status', 'Doing')).toBe(true);
    expect(isAllowedCreateValue(TRIAGE, 'status', 'To do')).toBe(false);
    expect(isAllowedCreateValue(TRIAGE, 'status', 'Parked')).toBe(false); // archived
    expect(isAllowedCreateValue(TRIAGE, 'category', 'OPS')).toBe(false); // no such field
  });

  it('lists every invalid submitted value by field', () => {
    expect(invalidCreateValues(TRIAGE, { status: 'Open', priority: 'P1', category: 'OPS' })).toEqual([
      { key: 'status', field: 'Status', value: 'Open' },
      { key: 'category', field: 'Category', value: 'OPS' },
    ]);
  });

  it('clears AI suggestions the project does not offer and reports them', () => {
    const r = sanitizeCreateSuggestions({ summary: 'x', status: 'Open', priority: 'P3', category: null }, TRIAGE);
    expect(r.fields).toEqual({ summary: 'x', status: null, priority: 'P3', category: null });
    expect(r.cleared).toEqual([{ key: 'status', field: 'Status', value: 'Open' }]);
  });
});

describe('explainCreateError', () => {
  // As recorded on 2026-11-24 (VERM-111 Claude check 2). Whether "Open" is
  // the refused value is unconfirmed.
  const RECORDED = 'An Open-type entity with the specified name ({1}) was not found';

  it('passes any other message through unchanged', () => {
    expect(explainCreateError('Summary is required', {}, null)).toEqual({ message: 'Summary is required', rejected: [], ambiguous: false });
  });

  it('names the field when a fresh read shows which value is no longer offered', () => {
    const r = explainCreateError(RECORDED, { status: 'Doing', category: 'Gone' }, { ...TRIAGE, category: { present: true, values: ['Kept'], defaultValue: null, canBeEmpty: true } });
    expect(r.ambiguous).toBe(false);
    expect(r.rejected).toEqual([{ key: 'category', field: 'Category', value: 'Gone' }]);
    expect(r.message).toBe('YouTrack refused Category "Gone": not a value in this project.');
  });

  it("trusts the template's first word only when it equals exactly one value that was sent", () => {
    const r = explainCreateError(RECORDED, { status: 'Open', priority: 'P1' }, null);
    expect(r.rejected).toEqual([{ key: 'status', field: 'Status', value: 'Open' }]);
    expect(r.ambiguous).toBe(false);
  });

  it('says so when YouTrack gives only {1} and nothing identifies the field', () => {
    const fresh: CreateFieldOptions = TRIAGE;
    const r = explainCreateError(RECORDED, { status: 'Doing', priority: 'P1' }, fresh);
    expect(r.ambiguous).toBe(true);
    expect(r.rejected).toEqual([]);
    expect(r.message).toContain('did not say which field');
    expect(r.message).toContain('Refresh the project options');
    expect(r.message).not.toContain('{1}');
  });
});

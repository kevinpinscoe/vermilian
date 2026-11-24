import { describe, expect, it } from 'vitest';
import { applyCreateFieldOptions } from './formOptions';
import type { CreateFieldOptions } from '../../../shared/createFieldOptions';

const opt = (values: string[], defaultValue: string | null = null) => ({ present: true, values, defaultValue, canBeEmpty: true });
const ABSENT = { present: false, values: [], defaultValue: null, canBeEmpty: true };

// No "To do", a configured default, custom states.
const TRIAGE: CreateFieldOptions = { status: opt(['Triage', 'Doing', 'Shipped'], 'Triage'), priority: opt(['P1', 'P2']), category: ABSENT };
// The shared-bundle shape, with INBOX offered.
const SHARED: CreateFieldOptions = { status: opt(['To do', 'In Progress', 'Done'], 'To do'), priority: opt(['Major', 'Normal'], 'Normal'), category: opt(['OPS', 'INBOX']) };

const empty = { status: '', priority: '', category: '' };

describe('applyCreateFieldOptions (VERM-115)', () => {
  it("fills untouched fields with the project's own defaults, or leaves them empty", () => {
    const r = applyCreateFieldOptions(empty, TRIAGE, new Set());
    expect(r.form).toEqual({ status: 'Triage', priority: '', category: '' });
    expect(r.flags).toEqual({});
  });

  it('never assumes "To do": switching projects replaces an untouched default without a flag', () => {
    const onShared = applyCreateFieldOptions(empty, SHARED, new Set()).form;
    expect(onShared.status).toBe('To do');
    const r = applyCreateFieldOptions(onShared, TRIAGE, new Set());
    expect(r.form).toEqual({ status: 'Triage', priority: '', category: '' });
    expect(r.flags).toEqual({});
  });

  it("clears and flags a user's choice the new project does not offer", () => {
    const r = applyCreateFieldOptions({ ...empty, status: 'In Progress' }, TRIAGE, new Set(['status']));
    expect(r.form.status).toBe('');
    expect(r.flags.status).toBe('Status "In Progress" is not offered by this project. Cleared.');
  });

  it("keeps a user's valid choice and their deliberate empty", () => {
    const r = applyCreateFieldOptions({ status: 'Doing', priority: '', category: '' }, TRIAGE, new Set(['status', 'priority']));
    expect(r.form).toEqual({ status: 'Doing', priority: '', category: '' });
  });

  it('flags an invalid AI suggestion as the AI\'s', () => {
    const r = applyCreateFieldOptions({ ...empty, status: 'Open' }, TRIAGE, new Set(['status']), new Set(['status']));
    expect(r.form.status).toBe('');
    expect(r.flags.status).toBe('AI suggested Status "Open", which this project does not offer. Cleared.');
  });

  it('clears a value for a field the project does not have', () => {
    const r = applyCreateFieldOptions({ ...empty, category: 'OPS' }, TRIAGE, new Set(['category']));
    expect(r.form.category).toBe('');
    expect(r.flags.category).toContain('no Category field');
  });

  it('sets INBOX for an Inbox project only when the project offers it', () => {
    expect(applyCreateFieldOptions(empty, SHARED, new Set(), new Set(), true)).toMatchObject({ inboxApplied: true, form: { category: 'INBOX' } });
    expect(applyCreateFieldOptions(empty, TRIAGE, new Set(), new Set(), true)).toMatchObject({ inboxApplied: false, form: { category: '' } });
    expect(applyCreateFieldOptions(empty, SHARED, new Set(['category']), new Set(), true).inboxApplied).toBe(false);
  });
});

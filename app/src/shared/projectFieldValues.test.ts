import { describe, expect, it } from 'vitest';
import { parseYouTrackProjectFields } from './youtrackProjectFields';
import {
  SELECT_FIELD_KEYS, dropdownOptions, fieldChoices, isResolvedStatus, mergedValueOrder, projectFieldValuesFromMetadata,
  selectEditorState,
} from './projectFieldValues';

type V = { name: string; isResolved?: boolean; archived?: boolean };
const field = (name: string, $type: string, values: V[], canBeEmpty = true) => ({
  field: { name }, $type, canBeEmpty, bundle: { values: values.map((v, ordinal) => ({ ...v, ordinal })) },
});

const vermLike = projectFieldValuesFromMetadata(parseYouTrackProjectFields([
  field('Status', 'StateProjectCustomField', [
    { name: 'Not yet started' }, { name: 'In Progress' }, { name: 'Consider' },
    { name: 'Done', isResolved: true }, { name: 'Wont do', isResolved: true }, { name: 'Legacy', archived: true },
  ], false),
  field('Edit host', 'EnumProjectCustomField', [{ name: 'FLDW' }, { name: 'core' }], false),
  field('Priority', 'EnumProjectCustomField', [{ name: 'Urgent' }, { name: 'Later' }]),
  field('Affected host', 'EnumProjectCustomField', [{ name: 'FLDW' }, { name: 'retired-vm', archived: true }]),
]));

const otherProject = projectFieldValuesFromMetadata(parseYouTrackProjectFields([
  field('Status', 'StateProjectCustomField', [{ name: 'Triage' }, { name: 'Fixed', isResolved: true }, { name: 'Consider', isResolved: true }]),
  field('Affected host', 'EnumProjectCustomField', [{ name: 'web1' }, { name: 'FLDW' }]),
]));

describe('projectFieldValuesFromMetadata (VERM-117)', () => {
  it('covers every dropdown field, including the five beyond Status/Priority/Category', () => {
    // Focus is not a dropdown: the star control writes its one value, Yes (ADR-0007).
    expect([...SELECT_FIELD_KEYS].sort()).toEqual([
      'affectedHost', 'category', 'editHost', 'issueDomain', 'priority', 'projectHealth', 'reportingCadence', 'status',
    ]);
  });

  it("keeps the project's own values in bundle order, separating archived ones", () => {
    expect(fieldChoices(vermLike, 'status')).toEqual({
      present: true,
      values: ['Not yet started', 'In Progress', 'Consider', 'Done', 'Wont do'],
      archived: ['Legacy'],
      resolved: ['Done', 'Wont do'],
      canBeEmpty: false,
    });
    expect(fieldChoices(vermLike, 'affectedHost').values).toEqual(['FLDW']);
    expect(fieldChoices(vermLike, 'affectedHost').archived).toEqual(['retired-vm']);
    expect(vermLike.priorityOrder).toEqual(['Urgent', 'Later']);
  });

  it('marks a field the project lacks as absent, with nothing to offer', () => {
    expect(fieldChoices(vermLike, 'category')).toEqual({ present: false, values: [], archived: [], resolved: [], canBeEmpty: false });
    expect(fieldChoices(null, 'status').present).toBe(false);
  });
});

describe('dropdownOptions', () => {
  it('keeps a saved archived value as the current value, offering active values as replacements', () => {
    expect(dropdownOptions(fieldChoices(vermLike, 'affectedHost'), 'retired-vm')).toEqual({ options: ['retired-vm', 'FLDW'], currentInactive: true });
  });
  it('offers only active values when the current one is active or empty', () => {
    expect(dropdownOptions(fieldChoices(vermLike, 'affectedHost'), 'FLDW')).toEqual({ options: ['FLDW'], currentInactive: false });
    expect(dropdownOptions(fieldChoices(vermLike, 'affectedHost'), null)).toEqual({ options: ['FLDW'], currentInactive: false });
  });
  it('keeps the current value visible when the values are not known', () => {
    expect(dropdownOptions(fieldChoices(null, 'status'), 'In Progress')).toEqual({ options: ['In Progress'], currentInactive: true });
  });
});

describe('isResolvedStatus', () => {
  it("follows each project's own resolution, so one name can differ between projects", () => {
    expect(isResolvedStatus(vermLike, 'Wont do')).toBe(true);
    expect(isResolvedStatus(otherProject, 'Fixed')).toBe(true);
    expect(isResolvedStatus(vermLike, 'Consider')).toBe(false);
    expect(isResolvedStatus(otherProject, 'Consider')).toBe(true);
    expect(isResolvedStatus(null, 'Done')).toBe(false);
  });
});

describe('mergedValueOrder', () => {
  it('merges projects in first-seen order, each in its own bundle order', () => {
    expect(mergedValueOrder([vermLike, otherProject], 'affectedHost')).toEqual(['FLDW', 'retired-vm', 'web1']);
    expect(mergedValueOrder([otherProject, undefined, vermLike], 'status').slice(0, 4)).toEqual(['Triage', 'Fixed', 'Consider', 'Not yet started']);
  });
});

describe('selectEditorState (VERM-117 review)', () => {
  it('disables editing after a failed refresh even though earlier choices are cached', () => {
    // The hook returns both: cached values from the earlier read, and the new error.
    const state = selectEditorState(vermLike, 'Simulated field read failure', 'affectedHost', 'FLDW');
    expect(state.mode).toBe('error');
    expect(state.options).toEqual([]);
    expect(state.clearable).toBe(false);
  });

  it('is loading, with nothing to choose, until the first read answers', () => {
    expect(selectEditorState(undefined, null, 'status', 'In Progress').mode).toBe('loading');
  });

  it('is absent for a field the project lacks', () => {
    expect(selectEditorState(vermLike, null, 'category', null).mode).toBe('absent');
  });

  it('offers clearing only where the project allows an empty value', () => {
    const required = selectEditorState(vermLike, null, 'editHost', 'FLDW');
    const optional = selectEditorState(vermLike, null, 'affectedHost', 'FLDW');
    expect(required).toMatchObject({ mode: 'editable', clearable: false, options: ['FLDW', 'core'] });
    expect(optional).toMatchObject({ mode: 'editable', clearable: true, options: ['FLDW'] });
  });

  it('marks an archived current value, offering the active values as replacements', () => {
    expect(selectEditorState(vermLike, null, 'affectedHost', 'retired-vm')).toMatchObject({
      mode: 'editable', options: ['retired-vm', 'FLDW'], currentInactive: true, currentArchived: true,
    });
    expect(selectEditorState(vermLike, null, 'affectedHost', 'gone')).toMatchObject({ currentInactive: true, currentArchived: false });
  });
});

import { describe, it, expect } from 'vitest';
import {
  FIELD_DEFS,
  FIELD_KEYS,
  CREATABLE_FIELD_DEFS,
  getFieldDef,
  toYouTrackValue,
  isValidUrl,
} from './fields';

describe('FIELD_DEFS', () => {
  it('has exactly one entry per field key, no duplicates', () => {
    expect(new Set(FIELD_KEYS).size).toBe(FIELD_KEYS.length);
    expect(FIELD_KEYS).toHaveLength(23);
  });

  it('the 13 fields added later have the confirmed live $type/wire shapes', () => {
    expect(FIELD_DEFS.projectHealth.$type).toBe('SingleEnumIssueCustomField');
    expect(FIELD_DEFS.projectHealth.wire).toBe('enum');
    expect(FIELD_DEFS.progressPercent.$type).toBe('SimpleIssueCustomField');
    expect(FIELD_DEFS.progressPercent.wire).toBe('integer');
    expect(FIELD_DEFS.nextStatusDue.$type).toBe('DateIssueCustomField');
    expect(FIELD_DEFS.nextStatusDue.wire).toBe('date');
    expect(FIELD_DEFS.reportingCadence.$type).toBe('SingleEnumIssueCustomField');
    expect(FIELD_DEFS.reportingCadence.wire).toBe('enum');
  });

  it('repoUrl is the only creatable field among the 13 added later', () => {
    const newKeys = [
      'ghosttyTabName', 'repoUrl', 'workingBranch', 'trackingFileUrl', 'todoFileUrl',
      'projectHealth', 'progressPercent', 'nextStatusDue', 'reportingCadence',
      'baseBranch', 'pullRequestUrl', 'artifactUrl', 'lastReportedCommit',
    ] as const;
    const creatableAmongNew = newKeys.filter((k) => getFieldDef(k).creatable);
    expect(creatableAmongNew).toEqual(['repoUrl']);
  });

  it('every ytName is unique across all fields', () => {
    const names = FIELD_KEYS.map((k) => FIELD_DEFS[k].ytName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every patchable def declares a $type and a wire kind', () => {
    for (const key of FIELD_KEYS) {
      const def = getFieldDef(key);
      if (def.patchable) {
        expect(def.$type).toBeTruthy();
        expect(def.wire).toBeTruthy();
      }
    }
  });

  it('category is a StateIssueCustomField, not SingleEnumIssueCustomField', () => {
    expect(FIELD_DEFS.category.$type).toBe('StateIssueCustomField');
    expect(FIELD_DEFS.category.wire).toBe('state');
  });

  it('notes is a SimpleIssueCustomField, not TextIssueCustomField', () => {
    expect(FIELD_DEFS.notes.$type).toBe('SimpleIssueCustomField');
  });

  it('relatedLink looks up the live field under its renamed ytName, Related link', () => {
    expect(FIELD_DEFS.relatedLink.ytName).toBe('Related link');
  });

  it('every select-editor field declares a non-empty options list', () => {
    for (const key of FIELD_KEYS) {
      const def = getFieldDef(key);
      if (def.editor === 'select') {
        expect(def.options?.length).toBeGreaterThan(0);
      }
    }
  });

  it('assignee is patchable but has no column or detail surface', () => {
    expect(FIELD_DEFS.assignee.patchable).toBe(true);
    expect(FIELD_DEFS.assignee.column).toBe(false);
    expect(getFieldDef('assignee').detailOrder).toBeUndefined();
  });

  it('dateTimeEntered is a column but not creatable or patchable', () => {
    expect(FIELD_DEFS.dateTimeEntered.column).toBe(true);
    expect(FIELD_DEFS.dateTimeEntered.creatable).toBe(false);
    expect(FIELD_DEFS.dateTimeEntered.patchable).toBe(false);
  });
});

describe('CREATABLE_FIELD_DEFS', () => {
  it('excludes dateTimeEntered and assignee', () => {
    const keys = CREATABLE_FIELD_DEFS.map((d) => d.key);
    expect(keys).not.toContain('dateTimeEntered');
    expect(keys).not.toContain('assignee');
  });
});

describe('toYouTrackValue', () => {
  it('wraps state and enum values in { name }', () => {
    expect(toYouTrackValue(FIELD_DEFS.status, 'Done')).toEqual({ name: 'Done' });
    expect(toYouTrackValue(FIELD_DEFS.priority, 'Normal')).toEqual({ name: 'Normal' });
  });

  it('wraps user values in { login }', () => {
    expect(toYouTrackValue(FIELD_DEFS.assignee, 'kinscoe')).toEqual({ login: 'kinscoe' });
  });

  it('passes integer values through as a raw number', () => {
    expect(toYouTrackValue(FIELD_DEFS.progressPercent, 42)).toBe(42);
    expect(toYouTrackValue(FIELD_DEFS.progressPercent, null)).toBeNull();
  });

  it('passes date values through as a raw number', () => {
    expect(toYouTrackValue(FIELD_DEFS.dueDate, 1234)).toBe(1234);
  });

  it('passes text values through as a raw string', () => {
    expect(toYouTrackValue(FIELD_DEFS.notes, 'hello')).toBe('hello');
  });

  it('passes null through unchanged regardless of wire kind', () => {
    expect(toYouTrackValue(FIELD_DEFS.status, null)).toBeNull();
    expect(toYouTrackValue(FIELD_DEFS.assignee, null)).toBeNull();
    expect(toYouTrackValue(FIELD_DEFS.dueDate, null)).toBeNull();
  });
});

describe('isValidUrl', () => {
  it('flags a non-http(s) value as invalid', () => {
    expect(isValidUrl('not-a-url')).toBeTruthy();
    expect(isValidUrl('ftp://example.com')).toBeTruthy();
  });

  it('accepts a valid https URL', () => {
    expect(isValidUrl('https://example.com')).toBeNull();
  });

  it('accepts a valid http URL', () => {
    expect(isValidUrl('http://example.com')).toBeNull();
  });
});

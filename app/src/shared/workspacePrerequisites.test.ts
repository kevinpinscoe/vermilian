import { describe, expect, it } from 'vitest';
import {
  describePrerequisiteLinkTypes,
  entriesFromRows,
  mapJiraLinkTypes,
  mapYouTrackLinkTypes,
  prerequisiteLinkTypesOf,
  prerequisiteRows,
  withPrerequisiteLinkTypes,
} from './workspacePrerequisites';
import { WORKSPACE_SCHEMA_VERSION, parseWorkspaceDocument, serialiseNewWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument } from './workspaceSchema';
import { mergeWorkspaceEdit } from './workspaceMerge';
import { WorkspaceSetupError, backendChangeProblem } from './workspaceSetup';

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-a1b2c3d4e5f6',
  name: 'Home',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: 'youtrack-1' },
  ai: { credentialRef: 'anthropic-1' },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-1'] }],
  boards: {},
  dismissals: {},
};
const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-0f0f0f0f0f0f',
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

// As the live YouTrack server and Jira Cloud word them.
const YT_TYPES = mapYouTrackLinkTypes([
  { name: 'Relates', directed: false, sourceToTarget: 'relates to', targetToSource: '' },
  { name: 'Depend', directed: true, sourceToTarget: 'is required for', targetToSource: 'depends on' },
  { name: 'Subtask', directed: true, sourceToTarget: 'parent for', targetToSource: 'subtask of' },
  { name: 'Required by', directed: true, sourceToTarget: 'needs', targetToSource: '' },
]);

describe('prerequisiteLinkTypesOf', () => {
  it("is the backend's default when nothing is saved, and the saved choice otherwise — empty included", () => {
    expect(prerequisiteLinkTypesOf(YT)).toEqual([{ type: 'Depend', side: 'inward' }]);
    expect(prerequisiteLinkTypesOf(JIRA)).toEqual([{ type: 'Blocks', side: 'inward' }]);
    expect(prerequisiteLinkTypesOf({ ...YT, prerequisiteLinkTypes: [] })).toEqual([]);
    const chosen = [{ type: 'Required by', side: 'outward' as const }];
    expect(prerequisiteLinkTypesOf({ ...YT, prerequisiteLinkTypes: chosen })).toEqual(chosen);
  });
});

describe('the schema field', () => {
  it('accepts absent, empty and chosen entries on either backend, and round-trips them', () => {
    for (const doc of [YT, JIRA]) {
      for (const p of [undefined, [], [{ type: 'Depend', side: 'inward' as const }, { type: 'Needs', side: 'outward' as const }]]) {
        const d = p === undefined ? doc : { ...doc, prerequisiteLinkTypes: p };
        expect(validateWorkspaceDocument(d)).toEqual([]);
        const back = parseWorkspaceDocument(serialiseNewWorkspaceDocument(d));
        expect(back.ok && back.document.prerequisiteLinkTypes).toEqual(p);
      }
    }
  });

  it('rejects a non-array, a bad side, a blank or over-long name, Subtask, and a duplicate type', () => {
    const paths = (p: unknown) => validateWorkspaceDocument({ ...YT, prerequisiteLinkTypes: p } as never).map((e) => [e.path, e.code]);
    expect(paths('Depend')).toEqual([['prerequisiteLinkTypes', 'invalid']]);
    expect(paths([{ type: 'Depend', side: 'both' }])).toEqual([['prerequisiteLinkTypes[0].side', 'invalid']]);
    expect(paths([{ type: '', side: 'inward' }])).toEqual([['prerequisiteLinkTypes[0].type', 'invalid']]);
    expect(paths([{ type: 'x'.repeat(256), side: 'inward' }])).toEqual([['prerequisiteLinkTypes[0].type', 'invalid']]);
    expect(paths([{ type: 'Subtask', side: 'inward' }])).toEqual([['prerequisiteLinkTypes[0].type', 'invalid']]);
    expect(paths([{ type: 'Depend', side: 'inward' }, { type: 'Depend', side: 'outward' }])).toEqual([['prerequisiteLinkTypes[1].type', 'duplicate']]);
    expect(paths(['Depend'])).toEqual([['prerequisiteLinkTypes[0]', 'invalid']]);
  });

  it('merges as one choice: an edit here and a different setting changed elsewhere both survive', () => {
    const edited = withPrerequisiteLinkTypes(YT, [{ type: 'Required by', side: 'outward' }]);
    const remote = { ...YT, name: 'Home renamed' };
    const r = mergeWorkspaceEdit(YT, edited, remote);
    expect(r.ok && r.document.prerequisiteLinkTypes).toEqual([{ type: 'Required by', side: 'outward' }]);
    expect(r.ok && r.document.name).toBe('Home renamed');
    const both = mergeWorkspaceEdit(YT, edited, { ...YT, prerequisiteLinkTypes: [] });
    expect(both.ok).toBe(false);
  });

  it('holds a backend change until the choice is reset, since link type names belong to one tracker', () => {
    const toJira = { ...JIRA, workspaceId: YT.workspaceId };
    expect(backendChangeProblem({ ...YT, folders: [] }, toJira)).toBeNull();
    expect(backendChangeProblem({ ...YT, folders: [], prerequisiteLinkTypes: [] }, toJira)).toMatch(/prerequisite link types/);
  });
});

describe('withPrerequisiteLinkTypes', () => {
  it('sets, empties and resets the choice, keeping everything else', () => {
    const set = withPrerequisiteLinkTypes({ ...YT, name: 'Kept' }, [{ type: 'Depend', side: 'inward' }, { type: 'Depend', side: 'outward' }]);
    expect(set.prerequisiteLinkTypes).toEqual([{ type: 'Depend', side: 'inward' }]);
    expect(set.name).toBe('Kept');
    expect(withPrerequisiteLinkTypes(YT, []).prerequisiteLinkTypes).toEqual([]);
    const reset = withPrerequisiteLinkTypes(set, null);
    expect('prerequisiteLinkTypes' in reset).toBe(false);
    expect(reset).toEqual({ ...YT, name: 'Kept' });
  });

  it('refuses Subtask, a blank name and a missing side', () => {
    expect(() => withPrerequisiteLinkTypes(YT, [{ type: 'Subtask', side: 'inward' }])).toThrow(WorkspaceSetupError);
    expect(() => withPrerequisiteLinkTypes(YT, [{ type: '', side: 'inward' }])).toThrow(WorkspaceSetupError);
    expect(() => withPrerequisiteLinkTypes(YT, [{ type: 'Depend', side: 'both' as never }])).toThrow(WorkspaceSetupError);
  });
});

describe('the trackers\' link types', () => {
  it("reads YouTrack's wordings per side, the type's name for a side with none, and one wording when undirected", () => {
    expect(YT_TYPES).toEqual([
      { name: 'Relates', directed: false, inward: 'relates to', outward: 'relates to' },
      { name: 'Depend', directed: true, inward: 'depends on', outward: 'is required for' },
      { name: 'Subtask', directed: true, inward: 'subtask of', outward: 'parent for' },
      { name: 'Required by', directed: true, inward: 'Required by', outward: 'needs' },
    ]);
    expect(mapYouTrackLinkTypes(null)).toEqual([]);
    expect(mapYouTrackLinkTypes([{ directed: true }, null])).toEqual([]);
  });

  it("reads Jira's inward and outward wordings; identical wordings are undirected", () => {
    expect(mapJiraLinkTypes({ issueLinkTypes: [
      { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      { name: 'Relates', inward: 'relates to', outward: 'relates to' },
      { name: 'Odd', inward: '', outward: 'precedes' },
      { inward: 'x', outward: 'y' },
    ] })).toEqual([
      { name: 'Blocks', directed: true, inward: 'is blocked by', outward: 'blocks' },
      { name: 'Relates', directed: false, inward: 'relates to', outward: 'relates to' },
      { name: 'Odd', directed: true, inward: 'Odd', outward: 'precedes' },
    ]);
    expect(mapJiraLinkTypes({})).toEqual([]);
  });
});

describe('the picker rows', () => {
  it("lists the tracker's types with the saved sides, Subtask and undirected types unchoosable", () => {
    const rows = prerequisiteRows(YT_TYPES, prerequisiteLinkTypesOf(YT));
    expect(rows.map((r) => [r.type, r.side, r.problem !== null])).toEqual([
      ['Relates', null, true],
      ['Depend', 'inward', false],
      ['Subtask', null, true],
      ['Required by', null, false],
    ]);
    expect(entriesFromRows(rows)).toEqual([{ type: 'Depend', side: 'inward' }]);
  });

  it('keeps a saved type the tracker no longer lists, as saved, until it is cleared', () => {
    const rows = prerequisiteRows(YT_TYPES, [{ type: 'Gone', side: 'outward' }, { type: 'Depend', side: 'inward' }]);
    expect(rows.at(-1)).toMatchObject({ type: 'Gone', onTracker: false, side: 'outward' });
    expect(entriesFromRows(rows)).toEqual([{ type: 'Depend', side: 'inward' }, { type: 'Gone', side: 'outward' }]);
    expect(entriesFromRows(rows.map((r) => (r.type === 'Gone' ? { ...r, side: null } : r)))).toEqual([{ type: 'Depend', side: 'inward' }]);
  });

  it('never saves a side for an unchoosable row', () => {
    const rows = prerequisiteRows(YT_TYPES, []).map((r) => ({ ...r, side: 'inward' as const }));
    expect(entriesFromRows(rows).map((e) => e.type)).toEqual(['Depend', 'Required by']);
  });
});

describe('describePrerequisiteLinkTypes', () => {
  it('names the default, an empty choice, and each chosen wording', () => {
    expect(describePrerequisiteLinkTypes(YT, YT_TYPES)).toBe('Default: Depend (“depends on”)');
    expect(describePrerequisiteLinkTypes(JIRA)).toBe('Default: Blocks (inward side)');
    expect(describePrerequisiteLinkTypes({ ...YT, prerequisiteLinkTypes: [] })).toBe('None: no link makes a ticket a prerequisite');
    expect(describePrerequisiteLinkTypes({ ...YT, prerequisiteLinkTypes: [{ type: 'Required by', side: 'outward' }] }, YT_TYPES)).toBe('Required by (“needs”)');
  });
});

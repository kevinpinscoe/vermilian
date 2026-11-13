import { describe, expect, it } from 'vitest';
import { defaultBoardConfig, dismissalKey } from './boardConfig';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from './workspaceSchema';
import { mergeWorkspaceEdit, stableStringify } from './workspaceMerge';

// Fictional values only.
const WS = 'ws-a1b2c3';

function doc(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: WS,
    name: 'Workspace A',
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12', '0-13'] }],
    boards: { '0-12': defaultBoardConfig('0-12') },
    dismissals: {},
    ...overrides,
  };
}

const copy = (d: WorkspaceDocument): WorkspaceDocument => JSON.parse(JSON.stringify(d)) as WorkspaceDocument;

function merged(base: WorkspaceDocument | null, edited: WorkspaceDocument, remote: WorkspaceDocument) {
  const r = mergeWorkspaceEdit(base, edited, remote);
  if (!r.ok) throw new Error(`expected a merge, got conflicts: ${JSON.stringify(r.conflicts)}`);
  return r.document;
}

function conflicts(base: WorkspaceDocument | null, edited: WorkspaceDocument, remote: WorkspaceDocument) {
  const r = mergeWorkspaceEdit(base, edited, remote);
  if (r.ok) throw new Error('expected conflicts, got a merge');
  return r.conflicts;
}

describe('mergeWorkspaceEdit — fields', () => {
  it('takes the remote document when this side changed nothing', () => {
    const base = doc();
    const remote = doc({ name: 'Renamed elsewhere' });
    expect(merged(base, copy(base), remote)).toEqual(remote);
  });

  it('keeps changes to different fields from both sides', () => {
    const base = doc();
    const out = merged(base, doc({ name: 'Renamed here' }), doc({ order: 3 }));
    expect(out.name).toBe('Renamed here');
    expect(out.order).toBe(3);
  });

  it('accepts the same change made on both sides', () => {
    const base = doc();
    expect(merged(base, doc({ name: 'Same' }), doc({ name: 'Same' })).name).toBe('Same');
  });

  it('refuses the same field changed differently on each side, naming it', () => {
    const c = conflicts(doc(), doc({ name: 'Here' }), doc({ name: 'There' }));
    expect(c).toEqual([expect.objectContaining({ path: 'name', reason: 'both-changed' })]);
  });

  it('merges backend fields separately while the kind is unchanged', () => {
    const base = doc();
    const edited = doc({ backend: { kind: 'youtrack', serverUrl: 'https://yt2.example.com', credentialRef: 'youtrack-1' } });
    const remote = doc({ backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-2' } });
    expect(merged(base, edited, remote).backend).toEqual({
      kind: 'youtrack',
      serverUrl: 'https://yt2.example.com',
      credentialRef: 'youtrack-2',
    });
  });

  it('refuses a backend kind change on one side against a backend edit on the other', () => {
    const jira = {
      kind: 'jira' as const,
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      cloudId: '',
      credentialRef: 'jira-1',
    };
    const remote = doc({ backend: { kind: 'youtrack', serverUrl: 'https://yt2.example.com', credentialRef: 'youtrack-1' } });
    // Jira project keys, so the edited document is itself valid.
    const folders = [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }];
    const c = conflicts(doc(), doc({ backend: jira, folders, boards: {} }), remote);
    expect(c.map((x) => x.path)).toContain('backend');
  });

  it('ignores object key order when comparing', () => {
    const base = doc();
    const reordered = JSON.parse(stableStringify(base)) as WorkspaceDocument; // keys sorted
    const remote = doc({ name: 'Renamed elsewhere' });
    expect(merged(base, reordered, remote).name).toBe('Renamed elsewhere');
  });

  it('refuses an edit for a different workspace', () => {
    const c = conflicts(doc(), doc({ workspaceId: 'ws-other' }), doc());
    expect(c[0].path).toBe('workspaceId');
  });
});

describe('mergeWorkspaceEdit — folders (by id)', () => {
  it('keeps a folder added here and a rename made elsewhere', () => {
    const base = doc();
    const edited = doc({
      folders: [...base.folders, { id: 'folder-2', name: 'Second', order: 1, parentId: null, projectIds: ['0-14'] }],
    });
    const remote = doc({ folders: [{ ...base.folders[0], name: 'Renamed' }] });
    const out = merged(base, edited, remote);
    expect(out.folders.map((f) => [f.id, f.name])).toEqual([
      ['folder-1', 'Renamed'],
      ['folder-2', 'Second'],
    ]);
  });

  it('merges different fields of the same folder', () => {
    const base = doc();
    const edited = doc({ folders: [{ ...base.folders[0], name: 'Renamed' }] });
    const remote = doc({ folders: [{ ...base.folders[0], projectIds: ['0-12'] }] });
    expect(merged(base, edited, remote).folders[0]).toMatchObject({ name: 'Renamed', projectIds: ['0-12'] });
  });

  it('refuses a folder changed here and deleted elsewhere', () => {
    const base = doc();
    const edited = doc({ folders: [{ ...base.folders[0], name: 'Renamed' }] });
    const remote = doc({ folders: [] });
    expect(conflicts(base, edited, remote)).toEqual([
      expect.objectContaining({ path: 'folders["folder-1"]', reason: 'changed-and-removed' }),
    ]);
  });

  it('removes a folder deleted on one side and untouched on the other', () => {
    const base = doc();
    expect(merged(base, doc({ folders: [] }), copy(base)).folders).toEqual([]);
  });

  it('refuses a combination that is invalid as a whole — one project in two folders', () => {
    const base = doc({ folders: [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: [] }] });
    const edited = doc({
      folders: [...base.folders, { id: 'folder-2', name: 'Mine', order: 1, parentId: null, projectIds: ['0-20'] }],
    });
    const remote = doc({
      folders: [...base.folders, { id: 'folder-3', name: 'Theirs', order: 1, parentId: null, projectIds: ['0-20'] }],
    });
    expect(conflicts(base, edited, remote)).toEqual([expect.objectContaining({ reason: 'invalid-result' })]);
  });
});

describe('mergeWorkspaceEdit — boards and dismissals (by key)', () => {
  it('keeps a board edited here and a board added elsewhere', () => {
    const base = doc();
    const board = base.boards['0-12'];
    const edited = doc({ boards: { '0-12': { ...board, colors: { status: { Open: '#00aa00' } } } } });
    const remote = doc({ boards: { ...base.boards, '0-13': defaultBoardConfig('0-13') } });
    const out = merged(base, edited, remote);
    expect(Object.keys(out.boards).sort()).toEqual(['0-12', '0-13']);
    expect(out.boards['0-12'].colors).toEqual({ status: { Open: '#00aa00' } });
  });

  it('merges a view added here with the active view changed elsewhere', () => {
    const base = doc();
    const board = base.boards['0-12'];
    const extra = { ...board.views[0], id: 'view-extra', name: 'Extra' };
    const edited = doc({ boards: { '0-12': { ...board, views: [...board.views, extra] } } });
    const remote = doc({ boards: { '0-12': { ...board, activeViewId: 'view-extra' } } });
    const out = merged(base, edited, remote).boards['0-12'];
    expect(out.views.map((v) => v.id)).toEqual([...board.views.map((v) => v.id), 'view-extra']);
    expect(out.activeViewId).toBe('view-extra');
  });

  it('refuses the same view changed differently on each side', () => {
    const base = doc();
    const board = base.boards['0-12'];
    const rename = (name: string) => doc({ boards: { '0-12': { ...board, views: [{ ...board.views[0], name }, ...board.views.slice(1)] } } });
    const c = conflicts(base, rename('Mine'), rename('Theirs'));
    expect(c[0].path).toBe(`boards["0-12"].views["${board.views[0].id}"]`);
  });

  it('refuses views reordered differently on each side', () => {
    const base = doc();
    const board = base.boards['0-12'];
    const views = [...board.views, { ...board.views[0], id: 'v2', name: 'Two' }, { ...board.views[0], id: 'v3', name: 'Three' }];
    const withViews = (vs: typeof views) => doc({ boards: { '0-12': { ...board, views: vs } } });
    const b = withViews(views);
    const [a, two, three] = views;
    const c = conflicts(b, withViews([two, a, three]), withViews([three, two, a]));
    expect(c).toEqual([expect.objectContaining({ reason: 'order-changed', path: 'boards["0-12"].views' })]);
  });

  it('keeps dismissals added on both sides', () => {
    const base = doc();
    const d = (issueId: string) => ({ [dismissalKey(WS, issueId)]: { workspace: WS, issueId, dismissedWeekOf: '2026-11-09' } });
    const out = merged(base, doc({ dismissals: d('2-1') }), doc({ dismissals: d('2-2') }));
    expect(Object.keys(out.dismissals).sort()).toEqual([dismissalKey(WS, '2-1'), dismissalKey(WS, '2-2')]);
  });
});

describe('mergeWorkspaceEdit — no base (create found an existing article)', () => {
  it('succeeds when the article already holds exactly this document', () => {
    expect(merged(null, doc(), doc())).toEqual(doc());
  });

  it('refuses every difference rather than overwrite', () => {
    const c = conflicts(null, doc({ name: 'Mine' }), doc({ name: 'Theirs' }));
    expect(c.map((x) => x.path)).toEqual(['name']);
  });
});

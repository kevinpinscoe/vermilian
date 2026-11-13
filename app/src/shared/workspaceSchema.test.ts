import { describe, expect, it } from 'vitest';
import { ALL_COLUMN_FIELDS, defaultBoardConfig, dismissalKey } from './boardConfig';
import { makeInitialConfig } from './workspace';
import {
  WORKSPACE_SCHEMA_VERSION,
  findSecretShapedValues,
  generateWorkspaceId,
  isCredentialRef,
  isValidWorkspaceId,
  parseWorkspaceDocument,
  serialiseNewWorkspaceDocument,
  serialiseUpdatedWorkspaceDocument,
  validateWorkspaceDocument,
  workspaceProjectIds,
  type WorkspaceDocument,
} from './workspaceSchema';

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Fictional values only (ADR-0011 §10). Secret-shaped test values are built at
// runtime from fragments so that no token-shaped literal exists in this public
// repository for a scanner to flag.

const fake = {
  atlassian: () => 'ATATT' + '3xFfGF0' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ'.repeat(2),
  anthropic: () => 'sk-' + 'ant-' + 'api03-' + 'Zq9Xw8Vu7Ts6Rq5Po4Nm3Lk2Jh1Gf0Ed'.repeat(2),
  youtrack: () => 'perm' + ':' + 'dXNlcg==' + '.' + 'MS0x' + '.' + 'Rk9vQmFyQmF6UXV4MTIzNDU2Nzg5',
  github: () => 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  bearer: () => 'Bear' + 'er ' + 'abcDEF123456ghiJKL789',
  highEntropy: () => 'Qm9' + 'x7Lp2Vn8Rt4Kw1Zs6Hd3Fj5Gb0Yc9Xe2Uq7Ai',
  pem: () => '-----BEGIN ' + 'PRIVATE KEY-----\nMIIBVQ\n-----END PRIVATE KEY-----',
};

function youtrackDoc(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: 'workspace-1780000000000',
    name: 'Workspace A',
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [
      { id: 'folder-1780000000001', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12', '0-13'] },
    ],
    boards: { '0-12': defaultBoardConfig('0-12') },
    dismissals: {
      [dismissalKey('workspace-1780000000000', '2-45')]: {
        workspace: 'workspace-1780000000000',
        issueId: '2-45',
        dismissedWeekOf: '2026-11-09',
      },
    },
    ...overrides,
  };
}

function jiraDoc(overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: 'ws-3f9a2c',
    name: 'Workspace B',
    order: 1,
    backend: {
      kind: 'jira',
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      cloudId: '',
      credentialRef: 'jira-1',
    },
    ai: { credentialRef: 'anthropic-1' },
    folders: [{ id: 'folder-demo', name: 'Demo', order: 0, parentId: null, projectIds: ['DEMO'] }],
    boards: {},
    dismissals: {},
    ...overrides,
  };
}

function paths(errors: { path: string }[]): string[] {
  return errors.map((e) => e.path);
}

// ─── Identifiers ─────────────────────────────────────────────────────────────

describe('workspace IDs', () => {
  it('accepts every ID shape Vermilian has ever created', () => {
    // makeInitialConfig's default, WorkspaceNav's `workspace-${Date.now()}`,
    // and the generated `ws-<hex>` form.
    expect(isValidWorkspaceId('workspace-default')).toBe(true);
    expect(isValidWorkspaceId('workspace-1793924847437')).toBe(true);
    expect(isValidWorkspaceId('ws-3f9a2c')).toBe(true);
    expect(isValidWorkspaceId(makeInitialConfig([]).workspaces[0].id)).toBe(true);
  });

  it('rejects IDs that are unsafe in an article title', () => {
    for (const bad of ['', 'Workspace A', 'WS-1', 'ws_1', '-ws', 'ws-', 'ws--1', 'ws/1', 'a'.repeat(65), 42, null]) {
      expect(isValidWorkspaceId(bad)).toBe(false);
    }
  });

  it('generates stable-format IDs that never collide in practice', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateWorkspaceId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^ws-[0-9a-f]{12}$/);
      expect(isValidWorkspaceId(id)).toBe(true);
    }
  });
});

describe('credential references', () => {
  it('accepts opaque names', () => {
    for (const ref of ['anthropic-1', 'jira-1', 'youtrack-1', 'account-2', 'a']) {
      expect(isCredentialRef(ref)).toBe(true);
    }
  });

  it('rejects anything that is not an opaque name, including raw secrets', () => {
    for (const bad of ['', 'Anthropic 1', 'jira_1', 'x'.repeat(65), fake.anthropic(), fake.atlassian(), 7, null]) {
      expect(isCredentialRef(bad)).toBe(false);
    }
  });
});

// ─── Valid documents ─────────────────────────────────────────────────────────

describe('validateWorkspaceDocument — valid documents', () => {
  it('accepts a YouTrack workspace with board settings and dismissals', () => {
    expect(validateWorkspaceDocument(youtrackDoc())).toEqual([]);
  });

  it('accepts a Jira workspace', () => {
    expect(validateWorkspaceDocument(jiraDoc())).toEqual([]);
  });

  it('accepts no credential selected (a new workspace has no Anthropic account)', () => {
    const doc = jiraDoc({ ai: { credentialRef: null } });
    expect(validateWorkspaceDocument(doc)).toEqual([]);
  });

  it('accepts a detected Jira cloudId (a UUID is not secret-shaped)', () => {
    const doc = jiraDoc();
    if (doc.backend.kind !== 'jira') throw new Error('fixture');
    doc.backend.cloudId = '11111111-2222-4333-8444-555555555555';
    expect(validateWorkspaceDocument(doc)).toEqual([]);
  });

  it('accepts a YouTrack server on http and under a path', () => {
    for (const serverUrl of ['http://youtrack.example.com', 'https://example.com/youtrack']) {
      const doc = youtrackDoc({ backend: { kind: 'youtrack', serverUrl, credentialRef: 'youtrack-1' } });
      expect(validateWorkspaceDocument(doc)).toEqual([]);
    }
  });

  it('accepts every existing board column field, sort and manual order', () => {
    const board = defaultBoardConfig('0-12');
    board.views[0].columns = ALL_COLUMN_FIELDS.map((field) => ({ field, width: 120, visible: true }));
    board.views[0].sort = { field: 'priority', direction: 'desc' };
    board.views[0].issueOrderByGroup = { 'In Progress': ['2-1', '2-2'] };
    board.colors = { Priority: { Critical: '#ff0000' } };
    expect(validateWorkspaceDocument(youtrackDoc({ boards: { '0-12': board } }))).toEqual([]);
  });
});

// ─── Invalid documents ───────────────────────────────────────────────────────

describe('validateWorkspaceDocument — invalid documents', () => {
  it('rejects a non-object', () => {
    expect(paths(validateWorkspaceDocument(null))).toEqual(['']);
    expect(paths(validateWorkspaceDocument([]))).toEqual(['']);
  });

  it('rejects a missing or unsupported schema version explicitly', () => {
    const { schema: _omit, ...noSchema } = youtrackDoc();
    void _omit;
    expect(validateWorkspaceDocument(noSchema)[0]).toMatchObject({ path: 'schema', code: 'unsupported-schema' });
    for (const schema of [0, 2, '1']) {
      const errors = validateWorkspaceDocument({ ...youtrackDoc(), schema });
      expect(errors).toEqual([expect.objectContaining({ path: 'schema', code: 'unsupported-schema' })]);
    }
  });

  it('rejects a bad workspace ID, empty name and non-integer order', () => {
    const errors = validateWorkspaceDocument({ ...youtrackDoc(), workspaceId: 'Workspace A', name: '  ', order: 1.5 });
    expect(paths(errors)).toEqual(expect.arrayContaining(['workspaceId', 'name', 'order']));
  });

  it('rejects an unknown backend kind', () => {
    const errors = validateWorkspaceDocument({ ...youtrackDoc(), backend: { kind: 'linear' } });
    expect(paths(errors)).toContain('backend.kind');
  });

  it('rejects a YouTrack server URL that is not http(s) or carries credentials, a query or a fragment', () => {
    for (const serverUrl of ['ftp://example.com', 'youtrack.example.com', 'https://u:p@example.com', 'https://example.com/?t=1', 'https://example.com/#x']) {
      const errors = validateWorkspaceDocument(
        youtrackDoc({ backend: { kind: 'youtrack', serverUrl, credentialRef: 'youtrack-1' } }),
      );
      expect(paths(errors)).toContain('backend.serverUrl');
    }
  });

  it('applies the existing Jira profile rules (https site, canonical form, email)', () => {
    const base = jiraDoc().backend;
    for (const [field, value] of [
      ['siteUrl', 'http://example.atlassian.net'],
      ['siteUrl', 'https://Example.atlassian.net/'],
      ['email', 'not-an-email'],
      ['cloudId', 7],
    ] as const) {
      const errors = validateWorkspaceDocument(jiraDoc({ backend: { ...base, [field]: value } as never }));
      expect(paths(errors)).toContain(`backend.${field}`);
    }
  });

  it('rejects malformed credential references', () => {
    const errors = validateWorkspaceDocument(
      jiraDoc({
        backend: { ...jiraDoc().backend, credentialRef: 'Jira Token' } as never,
        ai: { credentialRef: '' },
      }),
    );
    expect(paths(errors)).toEqual(expect.arrayContaining(['backend.credentialRef', 'ai.credentialRef']));
  });

  it('rejects malformed folders and duplicate folder IDs', () => {
    const folder = youtrackDoc().folders[0];
    const errors = validateWorkspaceDocument(
      youtrackDoc({
        folders: [folder, { ...folder }, { ...folder, id: '', projectIds: ['', 3] as never, parentId: 5 as never }],
      }),
    );
    expect(paths(errors)).toEqual(
      expect.arrayContaining(['folders[1].id', 'folders[2].id', 'folders[2].parentId', 'folders[2].projectIds[0]', 'folders[2].projectIds[1]']),
    );
  });

  it('rejects Jira project keys that are not Jira keys', () => {
    const errors = validateWorkspaceDocument(
      jiraDoc({ folders: [{ id: 'folder-demo', name: 'Demo', order: 0, parentId: null, projectIds: ['demo', '0-12'] }] }),
    );
    expect(paths(errors)).toEqual(['folders[0].projectIds[0]', 'folders[0].projectIds[1]']);
  });
});

// ─── Field-type compatibility with the existing board and Priority Desk model ─

describe('board settings reuse the existing field model', () => {
  function withView(patch: Record<string, unknown>) {
    const board = defaultBoardConfig('0-12');
    Object.assign(board.views[0], patch);
    return youtrackDoc({ boards: { '0-12': board } });
  }

  it('rejects a column field that is not one of ALL_COLUMN_FIELDS (from FIELD_DEFS)', () => {
    const errors = validateWorkspaceDocument(withView({ columns: [{ field: 'focusRank', width: 100, visible: true }] }));
    expect(paths(errors)).toEqual(['boards["0-12"].views[0].columns[0].field']);
  });

  it('enforces the view type and sort direction enums', () => {
    const errors = validateWorkspaceDocument(withView({ type: 'gantt', sort: { field: 'status', direction: 'up' } }));
    expect(paths(errors)).toEqual(
      expect.arrayContaining(['boards["0-12"].views[0].type', 'boards["0-12"].views[0].sort.direction']),
    );
  });

  it('enforces column widths, visibility and manual-order types', () => {
    const errors = validateWorkspaceDocument(
      withView({
        columns: [{ field: 'status', width: -1, visible: 'yes' }],
        issueOrderByGroup: { Done: [1] },
      }),
    );
    expect(paths(errors)).toEqual(
      expect.arrayContaining([
        'boards["0-12"].views[0].columns[0].width',
        'boards["0-12"].views[0].columns[0].visible',
        'boards["0-12"].views[0].issueOrderByGroup["Done"][0]',
      ]),
    );
  });

  it('requires each board to be keyed by its own boardId, with unique view IDs', () => {
    const board = defaultBoardConfig('0-99');
    board.views[1].id = board.views[0].id;
    const errors = validateWorkspaceDocument(youtrackDoc({ boards: { '0-12': board } }));
    expect(paths(errors)).toEqual(
      expect.arrayContaining(['boards["0-12"].boardId', 'boards["0-12"].views[1].id']),
    );
  });

  it('keeps dismissals scoped to this workspace and keyed exactly as dismissalKey builds them', () => {
    const other = { workspace: 'workspace-other', issueId: '2-1', dismissedWeekOf: '2026-11-09' };
    const errors = validateWorkspaceDocument(
      youtrackDoc({
        dismissals: {
          [dismissalKey('workspace-other', '2-1')]: other,
          'wrong-key': { workspace: 'workspace-1780000000000', issueId: '2-2', dismissedWeekOf: '2026-11-09' },
          [dismissalKey('workspace-1780000000000', '2-3')]: {
            workspace: 'workspace-1780000000000',
            issueId: '2-3',
            dismissedWeekOf: '2026-13-40',
          },
        },
      }),
    );
    expect(paths(errors)).toEqual(
      expect.arrayContaining([
        'dismissals["workspace-other:2-1"].workspace',
        'dismissals["wrong-key"]',
        'dismissals["workspace-1780000000000:2-3"].dismissedWeekOf',
      ]),
    );
  });
});

// ─── Secret rejection ────────────────────────────────────────────────────────

describe('secret-shaped values', () => {
  const secrets = Object.entries(fake);

  it.each(secrets)('flags a %s-shaped value', (_name, make) => {
    expect(findSecretShapedValues({ anywhere: make() })).toEqual([
      expect.objectContaining({ path: 'anywhere', code: 'secret' }),
    ]);
  });

  it('does not flag legitimate URLs, identifiers, references, UUIDs, hashes or prose', () => {
    const legit = {
      siteUrl: 'https://example.atlassian.net',
      serverUrl: 'https://youtrack.example.com/youtrack',
      link: 'https://github.com/example/repo/pull/12345678901234567890',
      email: 'user@example.com',
      cloudId: '11111111-2222-4333-8444-555555555555',
      sha: 'c4f7826e1f2a3b4c5d6e7f8091a2b3c4d5e6f708',
      ids: ['workspace-1793924847437', 'folder-unassigned', 'jira:DEMO-123', 'yt:2-45'],
      ref: 'anthropic-1',
      name: 'Workspace A: quarterly planning and review',
      color: '#ff0000',
      tokenized: 'Tokenization notes',
    };
    expect(findSecretShapedValues(legit)).toEqual([]);
  });

  it('flags a non-empty value under a credential-named key', () => {
    expect(paths(findSecretShapedValues({ backend: { apiToken: 'short1' }, password: 'x' }))).toEqual([
      'backend.apiToken',
      'password',
    ]);
    // credentialRef is the sanctioned way to name a credential.
    expect(findSecretShapedValues({ credentialRef: 'jira-1' })).toEqual([]);
  });

  it('flags credentials embedded in a URL', () => {
    expect(paths(findSecretShapedValues({ u: 'https://user:hunter2@example.com' }))).toEqual(['u']);
    expect(paths(findSecretShapedValues({ u: 'https://example.com/api?token=abc' }))).toEqual(['u']);
  });

  it('rejects a secret anywhere in a workspace, naming the field and never printing the value', () => {
    const secret = fake.atlassian();
    const doc = { ...jiraDoc(), name: secret, notes: { pasted: fake.anthropic() } };
    const errors = validateWorkspaceDocument(doc);
    expect(paths(errors)).toEqual(expect.arrayContaining(['name', 'notes.pasted']));
    const text = JSON.stringify(errors);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(fake.anthropic());
  });

  it('refuses to parse or serialise a document carrying a secret, without echoing it', () => {
    const secret = fake.youtrack();
    const raw = JSON.stringify({ ...youtrackDoc(), backend: { ...youtrackDoc().backend, token: secret } });
    const parsed = parseWorkspaceDocument(raw);
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(secret);

    const doc = youtrackDoc({ name: secret });
    let message = '';
    try {
      serialiseNewWorkspaceDocument(doc);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/name/);
    expect(message).not.toContain(secret);
  });
});

// ─── Parsing, unknown-field preservation and round trips ─────────────────────

describe('parseWorkspaceDocument', () => {
  it('tolerates a ```json fence, as YouTrack’s editor may add one', () => {
    const parsed = parseWorkspaceDocument('```json\n' + serialiseNewWorkspaceDocument(jiraDoc()) + '\n```');
    expect(parsed.ok && parsed.document).toEqual(jiraDoc());
  });

  it('reports malformed JSON as an error rather than an empty workspace', () => {
    const parsed = parseWorkspaceDocument('{ not json');
    expect(parsed).toEqual({ ok: false, errors: [expect.objectContaining({ path: '', code: 'malformed' })] });
  });

  it('rejects an unsupported schema version instead of guessing', () => {
    const parsed = parseWorkspaceDocument(JSON.stringify({ ...jiraDoc(), schema: 3 }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatchObject({ path: 'schema', code: 'unsupported-schema' });
  });

  it('keeps unknown fields out of the typed document', () => {
    const raw = JSON.stringify({ ...jiraDoc(), futureField: { x: 1 } });
    const parsed = parseWorkspaceDocument(raw);
    expect(parsed.ok && parsed.document).toEqual(jiraDoc());
    expect(parsed.ok && 'futureField' in parsed.document).toBe(false);
  });
});

describe('round trips', () => {
  it.each([
    ['YouTrack', youtrackDoc()],
    ['Jira', jiraDoc()],
  ])('%s: serialise → parse returns an identical document', (_label, doc) => {
    const parsed = parseWorkspaceDocument(serialiseNewWorkspaceDocument(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document).toEqual(doc);
  });

  it('is stable: serialise(parse(serialise(doc))) is byte-identical', () => {
    const once = serialiseNewWorkspaceDocument(youtrackDoc());
    const parsed = parseWorkspaceDocument(once);
    if (!parsed.ok) throw new Error('parse failed');
    expect(serialiseUpdatedWorkspaceDocument(parsed.source, parsed.document)).toBe(once);
  });

  it('preserves unknown fields at every level through read-modify-write', () => {
    const doc = youtrackDoc();
    const board = doc.boards['0-12'];
    const raw = {
      ...doc,
      futureTop: { nested: [1, 2] },
      backend: { ...doc.backend, futureBackend: 'b' },
      ai: { ...doc.ai, futureAi: true },
      folders: [{ ...doc.folders[0], futureFolder: 'f' }],
      boards: {
        '0-12': {
          ...board,
          futureBoard: 1,
          views: board.views.map((v, i) => ({
            ...v,
            futureView: i,
            columns: v.columns.map((c) => ({ ...c, futureColumn: c.field })),
          })),
        },
      },
      dismissals: Object.fromEntries(
        Object.entries(doc.dismissals).map(([k, d]) => [k, { ...d, futureDismissal: 'd' }]),
      ),
    };

    const parsed = parseWorkspaceDocument(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    // Modify known fields only: rename, reorder a column, add a folder.
    const edited: WorkspaceDocument = structuredClone(parsed.document);
    edited.name = 'Workspace A (renamed)';
    edited.folders.push({ id: 'folder-new', name: 'New', order: 1, parentId: null, projectIds: [] });
    const cols = edited.boards['0-12'].views[0].columns;
    cols.unshift(cols.pop()!);

    const out = JSON.parse(serialiseUpdatedWorkspaceDocument(parsed.source, edited));
    expect(out.name).toBe('Workspace A (renamed)');
    expect(out.futureTop).toEqual({ nested: [1, 2] });
    expect(out.backend.futureBackend).toBe('b');
    expect(out.ai.futureAi).toBe(true);
    expect(out.folders[0].futureFolder).toBe('f');
    expect(out.folders[1]).toEqual({ id: 'folder-new', name: 'New', order: 1, parentId: null, projectIds: [] });
    expect(out.boards['0-12'].futureBoard).toBe(1);
    expect(out.boards['0-12'].views[1].futureView).toBe(1);
    // Columns are matched by field, so a reorder carries each column's unknowns with it.
    for (const c of out.boards['0-12'].views[0].columns) expect(c.futureColumn).toBe(c.field);
    for (const d of Object.values(out.dismissals) as { futureDismissal: string }[]) {
      expect(d.futureDismissal).toBe('d');
    }
  });

  it('drops a removed known value instead of resurrecting it from the source', () => {
    const doc = youtrackDoc();
    doc.boards['0-12'].views[0].sort = { field: 'status', direction: 'asc' };
    const parsed = parseWorkspaceDocument(serialiseNewWorkspaceDocument(doc));
    if (!parsed.ok) throw new Error('parse failed');

    const edited = structuredClone(parsed.document);
    delete edited.boards['0-12'].views[0].sort;
    edited.dismissals = {};
    edited.folders = [];
    const out = JSON.parse(serialiseUpdatedWorkspaceDocument(parsed.source, edited));
    expect(out.boards['0-12'].views[0].sort).toBeUndefined();
    expect(out.dismissals).toEqual({});
    expect(out.folders).toEqual([]);
  });

  it('does not carry one backend kind’s unknown fields into another', () => {
    const raw = { ...youtrackDoc(), backend: { ...youtrackDoc().backend, futureBackend: 'yt-only' } };
    const parsed = parseWorkspaceDocument(JSON.stringify(raw));
    if (!parsed.ok) throw new Error('parse failed');
    // Switching backend also switches project IDs to the new backend's form.
    const edited = { ...parsed.document, backend: jiraDoc().backend, folders: jiraDoc().folders, boards: {}, dismissals: {} };
    const out = JSON.parse(serialiseUpdatedWorkspaceDocument(parsed.source, edited));
    expect(out.backend).toEqual(jiraDoc().backend);
  });

  it('refuses to serialise an invalid document', () => {
    expect(() => serialiseNewWorkspaceDocument({ ...jiraDoc(), workspaceId: 'Bad ID' })).toThrow(/workspaceId/);
  });

});

// ─── Update contract: an existing article is never rewritten without its source ─

describe('creating versus updating a workspace document', () => {
  function storedArticle(): string {
    // An article written by a newer Vermilian, carrying fields this one does not know.
    return JSON.stringify({ ...jiraDoc(), statusMapping: { DEMO: { Done: 'done' } }, masterPlan: 'plan-a' });
  }

  it('regression: read-modify-write of an existing article keeps fields this version does not know', () => {
    const parsed = parseWorkspaceDocument(storedArticle());
    if (!parsed.ok) throw new Error('parse failed');
    const edited = { ...parsed.document, name: 'Workspace B (renamed)' };

    const out = JSON.parse(serialiseUpdatedWorkspaceDocument(parsed.source, edited));
    expect(out.name).toBe('Workspace B (renamed)');
    expect(out.statusMapping).toEqual({ DEMO: { Done: 'done' } });
    expect(out.masterPlan).toBe('plan-a');
  });

  it('cannot update without the source handle that parse returned', () => {
    const parsed = parseWorkspaceDocument(storedArticle());
    if (!parsed.ok) throw new Error('parse failed');
    // @ts-expect-error — an update requires the source; the document alone is not enough.
    expect(() => serialiseUpdatedWorkspaceDocument(parsed.document)).toThrow(/original document/);
    // @ts-expect-error — a hand-built object is not a WorkspaceSource.
    expect(() => serialiseUpdatedWorkspaceDocument({ ...jiraDoc() }, parsed.document)).toThrow(/original document/);
    // A copy (as after crossing IPC) is not the handle either.
    expect(() => serialiseUpdatedWorkspaceDocument(structuredClone(parsed.source), parsed.document)).toThrow(
      /original document/,
    );
  });

  it('refuses to update one workspace from another workspace’s source', () => {
    const parsed = parseWorkspaceDocument(storedArticle());
    if (!parsed.ok) throw new Error('parse failed');
    expect(() => serialiseUpdatedWorkspaceDocument(parsed.source, youtrackDoc())).toThrow(/different workspace/);
  });

  it('the source handle exposes nothing and cannot be edited', () => {
    const parsed = parseWorkspaceDocument(storedArticle());
    if (!parsed.ok) throw new Error('parse failed');
    expect(Object.keys(parsed.source)).toEqual([]);
    expect(Object.isFrozen(parsed.source)).toBe(true);
  });

  it('serialiseNewWorkspaceDocument writes known fields only, for a workspace with no article yet', () => {
    const out = JSON.parse(serialiseNewWorkspaceDocument(jiraDoc()));
    expect(out).toEqual(jiraDoc());
  });
});

// ─── Projects: folders are the one project list, for either backend ──────────

describe('workspace projects', () => {
  it('stores selected Jira projects in folders and reads them back in folder order', () => {
    const doc = jiraDoc({
      folders: [
        { id: 'folder-b', name: 'Later', order: 1, parentId: null, projectIds: ['OPS'] },
        { id: 'folder-a', name: 'First', order: 0, parentId: null, projectIds: ['DEMO', 'TEST'] },
      ],
    });
    const parsed = parseWorkspaceDocument(serialiseNewWorkspaceDocument(doc));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(workspaceProjectIds(parsed.document)).toEqual(['DEMO', 'TEST', 'OPS']);
  });

  it('accepts a workspace with no projects selected yet', () => {
    expect(validateWorkspaceDocument(jiraDoc({ folders: [] }))).toEqual([]);
    expect(workspaceProjectIds(jiraDoc({ folders: [] }))).toEqual([]);
  });

  it('rejects the same project in two folders of one workspace', () => {
    const errors = validateWorkspaceDocument(
      jiraDoc({
        folders: [
          { id: 'folder-a', name: 'A', order: 0, parentId: null, projectIds: ['DEMO'] },
          { id: 'folder-b', name: 'B', order: 1, parentId: null, projectIds: ['DEMO'] },
        ],
      }),
    );
    expect(errors).toEqual([expect.objectContaining({ path: 'folders[1].projectIds[0]', code: 'duplicate' })]);
  });

  it('lets two workspaces select the same project independently', () => {
    const a = jiraDoc();
    const b = jiraDoc({ workspaceId: 'ws-0000aa', name: 'Workspace C' });
    expect(validateWorkspaceDocument(a)).toEqual([]);
    expect(validateWorkspaceDocument(b)).toEqual([]);
    expect(workspaceProjectIds(a)).toEqual(workspaceProjectIds(b));
  });

  it('has no second project list: a stray backend.projects is an unknown field, never read', () => {
    const raw = { ...jiraDoc(), backend: { ...jiraDoc().backend, projects: ['OTHER'] } };
    const parsed = parseWorkspaceDocument(JSON.stringify(raw));
    if (!parsed.ok) throw new Error('parse failed');
    expect('projects' in parsed.document.backend).toBe(false);
    expect(workspaceProjectIds(parsed.document)).toEqual(['DEMO']);
  });
});

describe('schema version', () => {
  it('is 1, as in ADR-0011’s example', () => {
    expect(WORKSPACE_SCHEMA_VERSION).toBe(1);
    expect(JSON.parse(serialiseNewWorkspaceDocument(jiraDoc())).schema).toBe(1);
  });
});

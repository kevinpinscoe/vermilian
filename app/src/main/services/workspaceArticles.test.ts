import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBoardConfig } from '../../shared/boardConfig';
import { WORKSPACE_SCHEMA_VERSION, serialiseNewWorkspaceDocument, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import {
  MAX_WRITE_ATTEMPTS,
  createWorkspaceArticle,
  listWorkspaceArticles,
  readWorkspaceArticle,
  updateWorkspaceArticle,
  type WorkspaceArticleClient,
  type WorkspaceArticleRecord,
} from './workspaceArticles';

// ─── A YouTrack stand-in with YouTrack's limits ──────────────────────────────
//
// Updates are unconditional and titles are not unique — exactly what the real
// Articles API gives us. `on` lets a test act as another machine at a precise
// moment: before the Nth call of a given kind.

type CallKind = 'list' | 'get' | 'create' | 'update';

class FakeArticles implements WorkspaceArticleClient {
  articles = new Map<string, WorkspaceArticleRecord>();
  calls: Record<CallKind, number> = { list: 0, get: 0, create: 0, update: 0 };
  hooks: Array<{ kind: CallKind; n: number; run: () => void }> = [];
  failList = false;
  incompleteList = false;
  private seq = 0;
  private clock = 1_000;

  on(kind: CallKind, n: number, run: () => void) {
    this.hooks.push({ kind, n, run });
  }

  private enter(kind: CallKind) {
    const n = ++this.calls[kind];
    for (const h of this.hooks) if (h.kind === kind && h.n === n) h.run();
  }

  /** Another machine (or a hand edit) writes directly. */
  put(summary: string, content: string): WorkspaceArticleRecord {
    const a = { id: `art-${++this.seq}`, summary, content, updated: ++this.clock };
    this.articles.set(a.id, a);
    return a;
  }

  overwrite(id: string, content: string) {
    const a = this.articles.get(id)!;
    a.content = content;
    a.updated = ++this.clock;
  }

  async list() {
    this.enter('list');
    if (this.failList) return { ok: false as const, reason: 'fetch-error' as const };
    if (this.incompleteList) return { ok: false as const, reason: 'incomplete' as const };
    return { ok: true as const, articles: [...this.articles.values()].map((a) => ({ ...a })) };
  }

  async get(id: string) {
    this.enter('get');
    const a = this.articles.get(id);
    return a ? { ...a } : null;
  }

  async create(workspaceId: string, content: string) {
    this.enter('create');
    return { ...this.put(workspaceArticleTitle(workspaceId), content) };
  }

  async update(id: string, content: string) {
    this.enter('update');
    if (!this.articles.has(id)) return null;
    this.overwrite(id, content);
    return { updated: this.articles.get(id)!.updated };
  }

  json(id: string): Record<string, unknown> {
    return JSON.parse(this.articles.get(id)!.content) as Record<string, unknown>;
  }
}

// ─── Fixtures (fictional values only) ────────────────────────────────────────

function doc(workspaceId: string, overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name: `Workspace ${workspaceId}`,
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12'] }],
    boards: { '0-12': defaultBoardConfig('0-12') },
    dismissals: {},
    ...overrides,
  };
}

const A = 'ws-aaaa01';
const B = 'ws-bbbb02';

/** An article written by a newer client: unknown fields at the top and nested. */
function withUnknownFields(d: WorkspaceDocument): string {
  const raw = JSON.parse(serialiseNewWorkspaceDocument(d)) as Record<string, unknown>;
  raw.futureTopLevel = { keep: true };
  (raw.backend as Record<string, unknown>).futureBackendOption = 'x';
  (raw.folders as Array<Record<string, unknown>>)[0].colour = 'teal';
  return JSON.stringify(raw, null, 2);
}

async function okSave(p: ReturnType<typeof updateWorkspaceArticle>) {
  const r = await p;
  if (!r.ok) throw new Error(`expected success, got ${r.reason}: ${r.message}`);
  return r;
}

let yt: FakeArticles;
beforeEach(() => {
  yt = new FakeArticles();
});

// ─── Independent workspaces ──────────────────────────────────────────────────

describe('two workspaces, independently', () => {
  it('creates, discovers, reads and updates each one without touching the other', async () => {
    const a = await okSave(createWorkspaceArticle(yt, doc(A, { order: 0 })));
    const b = await okSave(createWorkspaceArticle(yt, doc(B, { order: 1 })));
    expect(a.created && b.created).toBe(true);
    expect(yt.articles.get(a.articleId)!.summary).toBe('_vermilian-ws-ws-aaaa01');

    const listed = await listWorkspaceArticles(yt);
    expect(listed.ok && listed.workspaces.map((w) => [w.workspaceId, w.status])).toEqual([
      [A, 'ok'],
      [B, 'ok'],
    ]);

    const bBefore = yt.articles.get(b.articleId)!.content;
    const readA = await readWorkspaceArticle(yt, A);
    if (!readA.ok || readA.entry.status !== 'ok') throw new Error('read failed');
    const base = readA.entry.document;
    await okSave(updateWorkspaceArticle(yt, base, { ...base, name: 'Renamed A' }));

    expect(yt.json(a.articleId).name).toBe('Renamed A');
    expect(yt.articles.get(b.articleId)!.content).toBe(bBefore);
  });

  it('ignores articles whose titles lack the prefix', async () => {
    yt.put('_vermilian-config', '{}');
    yt.put('_vermilian-master-plan', '# plan');
    const listed = await listWorkspaceArticles(yt);
    expect(listed.ok && listed.workspaces).toEqual([]);
  });

  it('reports a failed listing rather than an empty one', async () => {
    yt.failList = true;
    expect(await listWorkspaceArticles(yt)).toMatchObject({ ok: false, reason: 'discovery-error' });
    expect(await createWorkspaceArticle(yt, doc(A))).toMatchObject({ ok: false, reason: 'discovery-error' });
    expect(yt.calls.create).toBe(0);
  });
});

// ─── Create versus update ────────────────────────────────────────────────────

describe('create versus update', () => {
  it('a create that finds the identical article writes nothing and creates nothing', async () => {
    yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A)));
    const r = await okSave(createWorkspaceArticle(yt, doc(A)));
    expect(r).toMatchObject({ created: false, unchanged: true });
    expect(yt.articles.size).toBe(1);
    expect(yt.calls.create + yt.calls.update).toBe(0);
  });

  it('a create that finds a different article takes the update path and never overwrites it', async () => {
    const existing = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A, { name: 'Theirs' })));
    const before = existing.content;
    const r = await createWorkspaceArticle(yt, doc(A, { name: 'Mine' }));
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    if (!r.ok && r.reason === 'conflict') expect(r.remote.name).toBe('Theirs');
    expect(yt.articles.size).toBe(1);
    expect(yt.articles.get(existing.id)!.content).toBe(before);
    expect(yt.calls.create).toBe(0);
  });

  it('a create that races another machine reports both articles', async () => {
    // The other machine's create lands between our check and our create.
    yt.on('create', 1, () => yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A))));
    const r = await createWorkspaceArticle(yt, doc(A));
    expect(r).toMatchObject({ ok: false, reason: 'ambiguous' });
    if (!r.ok && r.reason === 'ambiguous') expect(r.articleIds).toHaveLength(2);
  });

  // Post-create verification: success only when rediscovery finds exactly
  // one valid article under the title and it is the one just created. The
  // new article is never modified, whatever verification finds.
  describe('post-create verification', () => {
    const createdId = () => [...yt.articles.values()].find((a) => a.summary === workspaceArticleTitle(A))!.id;

    it('returns success when rediscovery finds exactly the new article', async () => {
      const r = await okSave(createWorkspaceArticle(yt, doc(A)));
      expect(r).toMatchObject({ created: true, articleId: createdId() });
      expect(yt.calls.list).toBe(2); // the check before, and the verification after
    });

    it.each([
      ['fails', () => { yt.failList = true; }],
      ['is incomplete', () => { yt.incompleteList = true; }],
    ])('does not claim success when the verifying discovery %s', async (_label, breakListing) => {
      yt.on('list', 2, breakListing);
      const r = await createWorkspaceArticle(yt, doc(A));
      expect(r).toMatchObject({ ok: false, reason: 'create-unverified', articleId: createdId() });
      // The created article is left exactly as written.
      expect(yt.articles.size).toBe(1);
      expect(yt.json(createdId())).toMatchObject({ workspaceId: A, name: doc(A).name });
      expect(yt.calls.update).toBe(0);
    });

    it('does not claim success when the new article is not found afterwards', async () => {
      yt.on('list', 2, () => yt.articles.clear());
      expect(await createWorkspaceArticle(yt, doc(A))).toMatchObject({ ok: false, reason: 'create-unverified' });
    });

    it('does not accept a different article under the title as its own', async () => {
      let ours = '';
      yt.on('list', 2, () => {
        ours = createdId();
        yt.articles.delete(ours);
        yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A, { name: 'Someone else' })));
      });
      const r = await createWorkspaceArticle(yt, doc(A));
      expect(r).toMatchObject({ ok: false, reason: 'create-unverified', articleId: ours });
    });

    it('does not accept an article that has become invalid', async () => {
      yt.on('list', 2, () => yt.overwrite(createdId(), '{ broken'));
      const r = await createWorkspaceArticle(yt, doc(A));
      expect(r).toMatchObject({ ok: false, reason: 'invalid-remote', articleId: createdId() });
      expect(yt.articles.get(createdId())!.content).toBe('{ broken');
      expect(yt.calls.update).toBe(0);
    });

    it('reports both articles of a create race and modifies neither', async () => {
      let theirs = '';
      yt.on('create', 1, () => {
        theirs = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A, { name: 'Theirs' }))).id;
      });
      const r = await createWorkspaceArticle(yt, doc(A));
      const ids = [...yt.articles.keys()].sort();
      expect(r).toMatchObject({ ok: false, reason: 'ambiguous', articleIds: ids });
      const ours = ids.find((id) => id !== theirs)!;
      expect(yt.json(theirs).name).toBe('Theirs');
      expect(yt.json(ours).name).toBe(doc(A).name);
      expect(yt.calls.update).toBe(0);
    });
  });

  it('an update of a workspace with no article is not-found, never a create', async () => {
    const r = await updateWorkspaceArticle(yt, doc(A), doc(A, { name: 'x' }));
    expect(r).toMatchObject({ ok: false, reason: 'not-found' });
    expect(yt.calls.create).toBe(0);
  });

  it('refuses an invalid edit before touching YouTrack', async () => {
    const bad = doc(A, { name: '' });
    expect(await createWorkspaceArticle(yt, bad)).toMatchObject({ ok: false, reason: 'invalid-edit' });
    expect(yt.calls.list).toBe(0);
  });
});

// ─── Concurrent edits (two machines) ─────────────────────────────────────────

describe('concurrent edits', () => {
  async function seeded(content?: string) {
    const rec = yt.put(workspaceArticleTitle(A), content ?? serialiseNewWorkspaceDocument(doc(A)));
    const r = await readWorkspaceArticle(yt, A);
    if (!r.ok || r.entry.status !== 'ok') throw new Error('seed read failed');
    return { id: rec.id, base: r.entry.document };
  }

  it('keeps both machines’ changes to different fields', async () => {
    const { id, base } = await seeded();
    // The Mac renamed the workspace after we read it.
    yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: 'Renamed on the Mac' }));
    // The FLDW, still editing from the old base, changes the order.
    await okSave(updateWorkspaceArticle(yt, base, { ...base, order: 4 }));
    expect(yt.json(id)).toMatchObject({ name: 'Renamed on the Mac', order: 4 });
  });

  it('keeps nested folder and board edits from both machines', async () => {
    const { id, base } = await seeded();
    yt.overwrite(
      id,
      serialiseNewWorkspaceDocument({ ...base, boards: { ...base.boards, '0-13': defaultBoardConfig('0-13') } }),
    );
    const edited = { ...base, folders: [{ ...base.folders[0], name: 'Renamed folder' }] };
    await okSave(updateWorkspaceArticle(yt, base, edited));
    const stored = yt.json(id) as unknown as WorkspaceDocument;
    expect(stored.folders[0].name).toBe('Renamed folder');
    expect(Object.keys(stored.boards).sort()).toEqual(['0-12', '0-13']);
  });

  it('refuses the same field changed on both machines, writes nothing and returns the remote', async () => {
    const { id, base } = await seeded();
    yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: 'Mac name' }));
    const before = yt.articles.get(id)!.content;
    const r = await updateWorkspaceArticle(yt, base, { ...base, name: 'FLDW name' });
    expect(r).toMatchObject({ ok: false, reason: 'conflict', conflicts: [expect.objectContaining({ path: 'name' })] });
    if (!r.ok && r.reason === 'conflict') expect(r.remote.name).toBe('Mac name');
    expect(yt.articles.get(id)!.content).toBe(before);
    expect(yt.calls.update).toBe(0);
  });

  it('writes nothing when the edit is already in the article', async () => {
    const { id, base } = await seeded();
    yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: 'Same' }));
    const r = await okSave(updateWorkspaceArticle(yt, base, { ...base, name: 'Same' }));
    expect(r.unchanged).toBe(true);
    expect(yt.calls.update).toBe(0);
  });
});

// ─── Unknown fields ──────────────────────────────────────────────────────────

describe('unknown fields', () => {
  it('survive an update, at the top level and nested', async () => {
    const rec = yt.put(workspaceArticleTitle(A), withUnknownFields(doc(A)));
    const r = await readWorkspaceArticle(yt, A);
    if (!r.ok || r.entry.status !== 'ok') throw new Error('read failed');
    expect(r.entry.document).not.toHaveProperty('futureTopLevel');
    await okSave(updateWorkspaceArticle(yt, r.entry.document, { ...r.entry.document, name: 'Renamed' }));
    const stored = yt.json(rec.id);
    expect(stored).toMatchObject({
      name: 'Renamed',
      futureTopLevel: { keep: true },
      backend: { futureBackendOption: 'x' },
      folders: [{ colour: 'teal' }],
    });
  });

  it('written by another machine after our read are kept, not just those we read', async () => {
    const rec = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A)));
    const r = await readWorkspaceArticle(yt, A);
    if (!r.ok || r.entry.status !== 'ok') throw new Error('read failed');
    // A newer client on the other machine adds unknown fields after our read.
    yt.overwrite(rec.id, withUnknownFields(doc(A)));
    await okSave(updateWorkspaceArticle(yt, r.entry.document, { ...r.entry.document, order: 2 }));
    expect(yt.json(rec.id)).toMatchObject({ order: 2, futureTopLevel: { keep: true } });
  });
});

// ─── Stale writes and bounded retries ────────────────────────────────────────

describe('stale-write detection', () => {
  async function seeded() {
    const rec = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A)));
    const r = await readWorkspaceArticle(yt, A);
    if (!r.ok || r.entry.status !== 'ok') throw new Error('seed read failed');
    yt.calls = { list: 0, get: 0, create: 0, update: 0 };
    return { id: rec.id, base: r.entry.document };
  }

  it('starts again when the article moves between the read and the write', async () => {
    const { id, base } = await seeded();
    // Another machine writes after our discovery, before our last look.
    yt.on('get', 1, () => yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: 'Mac' })));
    const r = await okSave(updateWorkspaceArticle(yt, base, { ...base, order: 7 }));
    expect(yt.json(id)).toMatchObject({ name: 'Mac', order: 7 });
    expect(r.document).toMatchObject({ name: 'Mac', order: 7 });
    expect(yt.calls.list).toBe(2); // one discarded attempt
    expect(yt.calls.update).toBe(1); // and only one write
  });

  it('starts again when another write lands after ours, and re-applies the edit', async () => {
    const { id, base } = await seeded();
    // Our write lands (update #1); the other machine overwrites it with a
    // document built from the old base before we read back.
    yt.on('get', 2, () => yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: 'Mac' })));
    await okSave(updateWorkspaceArticle(yt, base, { ...base, order: 7 }));
    expect(yt.json(id)).toMatchObject({ name: 'Mac', order: 7 });
    expect(yt.calls.update).toBe(2);
  });

  it('gives up after a bounded number of attempts and claims nothing', async () => {
    const { id, base } = await seeded();
    // The article changes before every last look.
    for (let n = 1; n <= MAX_WRITE_ATTEMPTS * 2; n++) {
      yt.on('get', n, () => yt.overwrite(id, serialiseNewWorkspaceDocument({ ...base, name: `Mac ${n}` })));
    }
    const r = await updateWorkspaceArticle(yt, base, { ...base, order: 7 });
    expect(r).toMatchObject({ ok: false, reason: 'race-unresolved', attempts: MAX_WRITE_ATTEMPTS });
    expect(yt.calls.list).toBe(MAX_WRITE_ATTEMPTS);
    expect(yt.calls.update).toBe(0);
  });
});

// ─── Duplicates and unusable articles ────────────────────────────────────────

describe('duplicate and invalid articles', () => {
  it('refuse the duplicated workspace, change neither article, and leave others working', async () => {
    const one = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A, { name: 'One' })));
    const two = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A, { name: 'Two' })));
    const other = yt.put(workspaceArticleTitle(B), serialiseNewWorkspaceDocument(doc(B)));
    const snapshot = () => [...yt.articles.values()].map((a) => ({ ...a }));
    const before = snapshot().filter((a) => a.id !== other.id);

    const listed = await listWorkspaceArticles(yt);
    if (!listed.ok) throw new Error('list failed');
    const entryA = listed.workspaces.find((w) => w.workspaceId === A)!;
    expect(entryA).toMatchObject({ status: 'ambiguous', articleIds: [one.id, two.id].sort() });
    expect(entryA.status === 'ambiguous' && entryA.message).toContain(one.id);
    expect(listed.workspaces.find((w) => w.workspaceId === B)).toMatchObject({ status: 'ok' });

    expect(await readWorkspaceArticle(yt, A)).toMatchObject({ ok: true, entry: { status: 'ambiguous' } });
    expect(await updateWorkspaceArticle(yt, doc(A), doc(A, { name: 'x' }))).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(await createWorkspaceArticle(yt, doc(A))).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(snapshot().filter((a) => a.id !== other.id)).toEqual(before);
    expect(yt.calls.create + yt.calls.update).toBe(0);

    // The unaffected workspace still updates normally.
    const readB = await readWorkspaceArticle(yt, B);
    if (!readB.ok || readB.entry.status !== 'ok') throw new Error('read B failed');
    await okSave(updateWorkspaceArticle(yt, readB.entry.document, { ...readB.entry.document, name: 'B renamed' }));
    expect(yt.json(other.id).name).toBe('B renamed');

    // Resolved by hand: one article remains, and the workspace works again.
    yt.articles.delete(two.id);
    const readA = await readWorkspaceArticle(yt, A);
    expect(readA).toMatchObject({ ok: true, entry: { status: 'ok', articleId: one.id } });
  });

  it('a duplicate created between attempts stops the update', async () => {
    const rec = yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A)));
    const base = doc(A);
    yt.on('get', 1, () => {
      yt.overwrite(rec.id, serialiseNewWorkspaceDocument({ ...base, name: 'moved' }));
      yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(A)));
    });
    expect(await updateWorkspaceArticle(yt, base, { ...base, order: 1 })).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(yt.calls.update).toBe(0);
  });

  it('report a malformed article and refuse to write over it', async () => {
    const rec = yt.put(workspaceArticleTitle(A), '{ not json');
    expect(await readWorkspaceArticle(yt, A)).toMatchObject({ ok: true, entry: { status: 'invalid', articleId: rec.id } });
    expect(await updateWorkspaceArticle(yt, doc(A), doc(A, { name: 'x' }))).toMatchObject({ ok: false, reason: 'invalid-remote' });
    expect(yt.articles.get(rec.id)!.content).toBe('{ not json');
  });

  it('report an article whose body names a different workspace than its title', async () => {
    yt.put(workspaceArticleTitle(A), serialiseNewWorkspaceDocument(doc(B)));
    expect(await readWorkspaceArticle(yt, A)).toMatchObject({
      ok: true,
      entry: { status: 'invalid', errors: [expect.objectContaining({ path: 'workspaceId' })] },
    });
  });
});

// ─── The process boundary ────────────────────────────────────────────────────

describe('results cross IPC as plain data', () => {
  it('every result survives a structured clone unchanged and carries no source handle', async () => {
    const created = await createWorkspaceArticle(yt, doc(A));
    const listed = await listWorkspaceArticles(yt);
    const read = await readWorkspaceArticle(yt, A);
    if (!read.ok || read.entry.status !== 'ok') throw new Error('read failed');
    const updated = await updateWorkspaceArticle(yt, read.entry.document, { ...read.entry.document, order: 9 });
    for (const r of [created, listed, read, updated]) {
      expect(structuredClone(r)).toEqual(r);
      expect(JSON.stringify(r)).not.toContain('source');
    }
  });
});

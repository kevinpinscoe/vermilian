import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBoardConfig } from '../../shared/boardConfig';
import { WORKSPACE_SCHEMA_VERSION, serialiseNewWorkspaceDocument, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import type { WorkspaceArticleClient, WorkspaceArticleRecord } from './workspaceArticles';
import { trackerConnectionKey } from './runwayMarkdownApply';
import { createPerWorkspaceApplyWorkspaces } from './runwayApplyWorkspaces';

// Synthetic IDs, names and hosts only.

/** YouTrack's Articles API, with hooks to act at a precise call. */
class FakeArticles implements WorkspaceArticleClient {
  articles = new Map<string, WorkspaceArticleRecord>();
  listCalls = 0;
  deleted: string[] = [];
  onList: ((n: number) => void) | null = null;
  ignoreDelete = false;
  failListAfter = Infinity;
  private seq = 0;

  put(summary: string, content: string): WorkspaceArticleRecord {
    const a = { id: `art-${++this.seq}`, summary, content, updated: this.seq };
    this.articles.set(a.id, a);
    return a;
  }
  async list() {
    const n = ++this.listCalls;
    this.onList?.(n);
    if (n > this.failListAfter) return { ok: false as const, reason: 'fetch-error' as const };
    return { ok: true as const, articles: [...this.articles.values()].map((a) => ({ ...a })) };
  }
  async get(id: string) {
    const a = this.articles.get(id);
    return a ? { ...a } : null;
  }
  async create(workspaceId: string, content: string) {
    return { ...this.put(workspaceArticleTitle(workspaceId), content) };
  }
  async update() {
    return null;
  }
  async delete(id: string) {
    this.deleted.push(id);
    if (!this.ignoreDelete) this.articles.delete(id);
    return true;
  }
}

const SOURCE: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-source01',
  name: 'Inbox',
  order: 0,
  backend: { kind: 'jira', siteUrl: 'https://site-a.example.test', email: 'someone@example.test', cloudId: 'cloud-1', credentialRef: 'jira-1' },
  ai: { credentialRef: 'anthropic-1' },
  folders: [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
  boards: { DEMO: defaultBoardConfig('DEMO') },
  dismissals: {},
};
const KEY = trackerConnectionKey(SOURCE.backend);
const NEW_ID = 'ws-new00001';

let yt: FakeArticles;
const store = () => createPerWorkspaceApplyWorkspaces({ client: async () => yt, generateWorkspaceId: () => NEW_ID });
beforeEach(() => {
  yt = new FakeArticles();
  yt.put(workspaceArticleTitle(SOURCE.workspaceId), serialiseNewWorkspaceDocument(SOURCE));
});

describe('per-workspace Apply create and cleanup (VERM-104)', () => {
  it('creates the workspace with only the connection copied, and reports its article', async () => {
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: true, workspaceId: NEW_ID, articleIds: ['art-2'] });
    const made = JSON.parse(yt.articles.get('art-2')!.content) as WorkspaceDocument;
    expect(made).toMatchObject({ workspaceId: NEW_ID, name: 'Ship the offline reader', backend: SOURCE.backend, ai: { credentialRef: null } });
    expect(made.folders.flatMap((f) => f.projectIds)).toEqual([]);
  });

  it('creation succeeds but verification fails: the generated ID and the created article are kept, and cleanup removes exactly that article', async () => {
    // The verifying discovery (the third listing: source, existence check, recheck) does not see the new article yet.
    yt.failListAfter = 2;
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: false, workspaceId: NEW_ID, articleIds: ['art-2'] });
    expect(r.ok ? '' : r.error).toMatch(/art-2/);
    expect(yt.articles.has('art-2')).toBe(true);

    yt.failListAfter = Infinity;
    const unrelated = yt.put(workspaceArticleTitle('ws-other0001'), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: 'ws-other0001', name: 'Other' }));
    expect(await store().remove(NEW_ID, ['art-2'])).toEqual({ ok: true });
    expect(yt.deleted).toEqual(['art-2']);
    expect([...yt.articles.keys()].sort()).toEqual(['art-1', unrelated.id].sort());
  });

  it('cleanup that cannot confirm the removal reports the exact article', async () => {
    yt.failListAfter = 2;
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: false, articleIds: ['art-2'] });
    yt.failListAfter = Infinity;
    yt.ignoreDelete = true; // YouTrack answers success, but the article stays
    const removed = await store().remove(NEW_ID, ['art-2']);
    expect(removed).toMatchObject({ ok: false, articleIds: ['art-2'] });
    expect(removed.ok ? '' : removed.error).toMatch(/art-2/);
  });

  it('with no confirmed article, cleanup finds the article under the generated ID’s title, and only that one', async () => {
    yt.put(workspaceArticleTitle(NEW_ID), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Ship the offline reader' }));
    expect(await store().remove(NEW_ID, [])).toEqual({ ok: true });
    expect(yt.deleted).toEqual(['art-2']);
    expect(yt.articles.has('art-1')).toBe(true);
  });

  it('never deletes an article given by ID that does not hold the generated ID’s title', async () => {
    expect(await store().remove(NEW_ID, ['art-1'])).toMatchObject({ ok: false, articleIds: ['art-1'] });
    expect(yt.deleted).toEqual([]);
  });

  it('refuses to create when the source connection is no longer the one checked, and creates nothing', async () => {
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, trackerConnectionKey({ ...SOURCE.backend, siteUrl: 'https://site-b.example.test' }));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? null : r.workspaceId).toBeUndefined();
    expect(yt.articles.size).toBe(1);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultBoardConfig } from '../../shared/boardConfig';
import { WORKSPACE_SCHEMA_VERSION, serialiseNewWorkspaceDocument, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import { applyRecoveryLines, type RunwayImportMatchArgs, type RunwayImportMatchResult } from '../../shared/runwayImport';
import type { ArticleLookup, WorkspaceArticleClient, WorkspaceArticleRecord } from './workspaceArticles';
import { createRunwayMarkdownApply, trackerConnectionKey } from './runwayMarkdownApply';
import { createPerWorkspaceApplyWorkspaces } from './runwayApplyWorkspaces';
import { openRunwayDb } from './runwayDb';
import { createRunwayItemStore } from './runwayItemStore';

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
  async lookup(id: string): Promise<ArticleLookup> {
    const a = this.articles.get(id);
    return a ? { state: 'found', article: { ...a } } : { state: 'absent' };
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

  it('cleanup deletes only the confirmed article: another article with the same title survives and is reported for inspection', async () => {
    const title = workspaceArticleTitle(NEW_ID);
    const ours = yt.put(title, serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Ship the offline reader' }));
    const other = yt.put(title, serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Someone else' }));
    const r = await store().remove(NEW_ID, [ours.id]);
    expect(yt.deleted).toEqual([ours.id]);
    expect(yt.articles.has(other.id)).toBe(true);
    expect(r).toMatchObject({ ok: false, articleIds: [], inspectArticleIds: [other.id] });
    expect(r.ok ? '' : r.error).toMatch(new RegExp(`${other.id}.*not created by this import|inspect`));
  });

  it('verification finds an ambiguous title: create keeps only the ID its own create returned, and rollback leaves the other article', async () => {
    const title = workspaceArticleTitle(NEW_ID);
    let other = '';
    // During the verifying discovery, another article appears under the same title.
    yt.onList = (n) => {
      if (n === 3) other = yt.put(title, serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Someone else' })).id;
    };
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: false, workspaceId: NEW_ID, articleIds: ['art-2'] });
    yt.onList = null;
    const removed = await store().remove(NEW_ID, ['art-2']);
    expect(yt.deleted).toEqual(['art-2']);
    expect(yt.articles.has(other)).toBe(true);
    expect(removed).toMatchObject({ ok: false, articleIds: [], inspectArticleIds: [other] });
  });

  it('with no confirmed article, nothing is deleted: an article under the generated ID’s title is reported, not removed', async () => {
    const found = yt.put(workspaceArticleTitle(NEW_ID), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Ship the offline reader' }));
    expect(await store().remove(NEW_ID, [])).toMatchObject({ ok: false, articleIds: [], inspectArticleIds: [found.id] });
    expect(yt.deleted).toEqual([]);
  });

  it('never deletes an article given by ID that does not hold the generated ID’s title', async () => {
    expect(await store().remove(NEW_ID, ['art-1'])).toMatchObject({ ok: false, articleIds: [], inspectArticleIds: ['art-1'] });
    expect(yt.deleted).toEqual([]);
  });

  it('refuses to create when the source connection is no longer the one checked, and creates nothing', async () => {
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, trackerConnectionKey({ ...SOURCE.backend, siteUrl: 'https://site-b.example.test' }));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? null : r.workspaceId).toBeUndefined();
    expect(yt.articles.size).toBe(1);
  });
});

describe('an article that already holds the generated ID is not this import’s (VERM-104)', () => {
  it('a pre-existing article at the generated ID: Apply refuses the destination, writes nothing, and keeps it out of rollback', async () => {
    const existing = yt.put(workspaceArticleTitle(NEW_ID), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Someone else’s' }));
    const before = existing.content;
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? 'created' : r.workspaceId).toBeUndefined();
    expect(r.ok ? [] : (r.articleIds ?? [])).toEqual([]);
    expect(yt.articles.get(existing.id)?.content).toBe(before);
    expect(yt.articles.size).toBe(2);
  });

  it('an article that appears at the generated ID just before the create: the save is not counted as this import’s, and the article survives', async () => {
    let existing = '';
    yt.onList = (n) => {
      // After the adapter's own check, before createWorkspaceArticle's.
      if (n === 2) existing = yt.put(workspaceArticleTitle(NEW_ID), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Ship the offline reader' })).id;
    };
    const r = await store().create('Ship the offline reader', SOURCE.workspaceId, KEY);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? 'created' : r.workspaceId).toBeUndefined();
    expect(yt.articles.has(existing)).toBe(true);
    expect(yt.deleted).toEqual([]);
  });
});

describe('the same-title case through Apply to the recovery message (VERM-104)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('our article is removed; the other is left in place for inspection, and the message never says to remove it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vermilian-apply-'));
    const db = openRunwayDb(join(dir, 'runway.sqlite'));
    try {
      const items = createRunwayItemStore(db);
      let other = '';
      // Listings: Apply, Apply under the gate, the create's source read, its existence check, its verification.
      // During the verification, another article appears under the same title (ambiguous).
      yt.onList = (n) => {
        if (n === 5) other = yt.put(workspaceArticleTitle(NEW_ID), serialiseNewWorkspaceDocument({ ...SOURCE, workspaceId: NEW_ID, name: 'Someone else' })).id;
      };
      const match = async (args: RunwayImportMatchArgs): Promise<RunwayImportMatchResult> => ({
        ok: true,
        groups: args.groups.map((g) => ({
          groupKey: g.groupKey,
          workspaceId: g.workspaceId,
          ok: true as const,
          connectionKey: KEY,
          candidates: g.candidates.map((c) => ({ ...c, status: 'matched' as const, ticket: { issueId: 'jira:DEMO-1', key: 'DEMO-1', summary: 'One' } })),
        })),
      });
      const apply = createRunwayMarkdownApply({
        workspaces: store(),
        match,
        connectionKey: async (id) => (id === SOURCE.workspaceId ? KEY : null),
        gate: { run: async (op) => op() },
        store: () => items,
        backup: async () => join(dir, 'runway-before-import-1.sqlite'),
      });
      const r = await apply({
        groups: [{ groupKey: 'g0', target: { kind: 'new', name: 'Ship the offline reader', connectionWorkspaceId: SOURCE.workspaceId }, connectionKey: KEY, rows: [{ kind: 'ticket', issueId: 'jira:DEMO-1', text: 'DEMO-1', line: 1 }] }],
      });
      if (r.ok) throw new Error('expected the create to be unverified');
      expect(yt.deleted).toEqual(['art-2']);
      expect(yt.articles.has(other)).toBe(true);
      expect(r.remaining).toEqual([{ workspaceId: NEW_ID, name: 'Ship the offline reader', articleIds: [], inspectArticleIds: [other] }]);
      expect(applyRecoveryLines(r.remaining[0])).toEqual({
        workspace: `Ship the offline reader (${NEW_ID})`,
        remove: null,
        inspect: `Left in place for inspection: article ${other}`,
      });
    } finally {
      db.close();
    }
  });

  it('a confirmed import leftover is labelled to remove by hand, separately from one left for inspection', () => {
    expect(applyRecoveryLines({ workspaceId: 'ws-1', name: 'One', articleIds: ['art-2'], inspectArticleIds: ['art-7'] })).toEqual({
      workspace: 'One (ws-1)',
      remove: 'Created by this import and not confirmed removed; remove by hand: article art-2',
      inspect: 'Left in place for inspection: article art-7',
    });
    expect(applyRecoveryLines({ workspaceId: 'workspace-1', name: 'Legacy', articleIds: [], inspectArticleIds: [] }).remove).toBe(
      'Created by this import and not confirmed removed; remove it by hand.',
    );
  });
});

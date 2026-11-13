import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBoardConfig, dismissalKey } from '../../shared/boardConfig';
import { parseWorkspaceDocument, serialiseNewWorkspaceDocument, type WorkspaceDocument } from '../../shared/workspaceSchema';
import { WORKSPACE_ARTICLE_PREFIX, workspaceArticleTitle } from '../../shared/workspaceArticle';
import {
  CONFIG_ARTICLE_TITLE,
  JIRA_PROFILE_ARTICLE_TITLE,
  type WorkspaceMigrationReport,
  type WorkspaceMigrationResult,
} from '../../shared/workspaceMigration';
import type { WorkspaceArticleRecord } from './workspaceArticles';
import { applyWorkspaceMigration, planWorkspaceMigration, type WorkspaceMigrationClient } from './workspaceMigration';

// ─── A YouTrack stand-in: one article store, YouTrack's limits ───────────────

class FakeYouTrack implements WorkspaceMigrationClient {
  articles = new Map<string, WorkspaceArticleRecord>();
  creates = 0;
  updates: string[] = [];
  failCreate = false;
  failListAfterCreate = false;
  failSources = false;
  private seq = 0;
  private clock = 1_000;

  put(summary: string, content: string): WorkspaceArticleRecord {
    const a = { id: `art-${++this.seq}`, summary, content, updated: ++this.clock };
    this.articles.set(a.id, a);
    return a;
  }

  rewrite(id: string, content: string) {
    const a = this.articles.get(id)!;
    a.content = content;
    a.updated = ++this.clock;
  }

  private all(pred: (a: WorkspaceArticleRecord) => boolean) {
    return [...this.articles.values()].filter(pred).map((a) => ({ ...a }));
  }

  async listSources() {
    if (this.failSources) return { ok: false as const, reason: 'fetch-error' as const };
    return { ok: true as const, articles: this.all((a) => a.summary === CONFIG_ARTICLE_TITLE || a.summary === JIRA_PROFILE_ARTICLE_TITLE) };
  }

  async list() {
    if (this.failListAfterCreate && this.creates > 0) return { ok: false as const, reason: 'fetch-error' as const };
    return { ok: true as const, articles: this.all((a) => a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX)) };
  }

  async get(id: string) {
    const a = this.articles.get(id);
    return a ? { ...a } : null;
  }

  async create(workspaceId: string, content: string) {
    if (this.failCreate) return null;
    this.creates++;
    return { ...this.put(workspaceArticleTitle(workspaceId), content) };
  }

  async update(id: string, content: string) {
    this.updates.push(id);
    if (!this.articles.has(id)) return null;
    this.rewrite(id, content);
    return { updated: this.articles.get(id)!.updated };
  }

  workspaceArticles() {
    return this.all((a) => a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX));
  }

  workspaceDoc(workspaceId: string): WorkspaceDocument {
    const [a] = this.all((x) => x.summary === workspaceArticleTitle(workspaceId));
    const parsed = parseWorkspaceDocument(a.content);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return parsed.document;
  }
}

// ─── Fixtures (fictional values only) ────────────────────────────────────────

const SERVER = 'https://youtrack.example.com';
const W1 = 'workspace-1700000000001';
const W2 = 'workspace-1700000000002';
const W3 = 'workspace-1700000000003';

function legacyConfig(overrides: Record<string, unknown> = {}) {
  const board = { ...defaultBoardConfig('0-12'), colors: { status: { Open: '#00aa00' } } };
  return {
    version: 1,
    activeWorkspaceId: W2,
    workspaces: [
      { id: W1, name: 'Workspace A', order: 0, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-12'] }] },
      { id: W2, name: 'Workspace B', order: 1, folders: [{ id: 'folder-b', name: 'Mine', order: 0, parentId: null, projectIds: ['0-13', '0-14'] }] },
      { id: W3, name: 'Workspace C', order: 2, folders: [{ id: 'folder-c', name: 'Trial', order: 0, parentId: null, projectIds: ['0-12', '0-15'] }] },
    ],
    boards: { '0-12': board, '0-13': defaultBoardConfig('0-13'), '0-99': defaultBoardConfig('0-99') },
    dismissals: {
      [dismissalKey(W2, '2-1')]: { workspace: W2, issueId: '2-1', dismissedWeekOf: '2026-11-09' },
      [dismissalKey('workspace-gone', '2-2')]: { workspace: 'workspace-gone', issueId: '2-2', dismissedWeekOf: '2026-11-09' },
    },
    ...overrides,
  };
}

const PROFILE = { siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '' };

let yt: FakeYouTrack;
let configId: string;

function seed(config: unknown = legacyConfig(), jira?: unknown) {
  yt = new FakeYouTrack();
  configId = yt.put(CONFIG_ARTICLE_TITLE, JSON.stringify(config, null, 2)).id;
  if (jira !== undefined) yt.put(JIRA_PROFILE_ARTICLE_TITLE, JSON.stringify(jira, null, 2));
}

function report(r: WorkspaceMigrationResult): WorkspaceMigrationReport {
  if (!r.ok) throw new Error(`expected a report, got ${JSON.stringify(r)}`);
  return r;
}

const item = (r: WorkspaceMigrationReport, id: string) => r.items.find((i) => i.workspaceId === id)!;

function sourcesSnapshot() {
  return [...yt.articles.values()]
    .filter((a) => !a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX))
    .map((a) => ({ ...a }));
}

beforeEach(() => seed());

// ─── Plan ────────────────────────────────────────────────────────────────────

describe('planWorkspaceMigration', () => {
  it('maps every workspace with its ID, name, order, folders, own boards and own dismissals', async () => {
    const r = report(await planWorkspaceMigration(yt, SERVER));
    expect(r.items.map((i) => [i.workspaceId, i.action])).toEqual([
      [W1, 'create'],
      [W2, 'create'],
      [W3, 'create'],
    ]);
    const a = item(r, W1).document!;
    expect(a).toMatchObject({ workspaceId: W1, name: 'Workspace A', order: 0 });
    expect(a.folders).toEqual(legacyConfig().workspaces[0].folders);
    expect(a.boards).toEqual({ '0-12': legacyConfig().boards['0-12'] });
    expect(a.dismissals).toEqual({});

    const b = item(r, W2).document!;
    expect(Object.keys(b.boards)).toEqual(['0-13']); // 0-14 has no board config
    expect(b.dismissals).toEqual({ [dismissalKey(W2, '2-1')]: legacyConfig().dismissals[dismissalKey(W2, '2-1')] });

    // A project in two workspaces gets its board in both.
    expect(Object.keys(item(r, W3).document!.boards)).toEqual(['0-12']);
  });

  it('gives every migrated workspace a YouTrack backend on the current server, youtrack-1 and anthropic-1', async () => {
    const r = report(await planWorkspaceMigration(yt, SERVER));
    for (const i of r.items) {
      expect(i.document!.backend).toEqual({ kind: 'youtrack', serverUrl: SERVER, credentialRef: 'youtrack-1' });
      expect(i.document!.ai).toEqual({ credentialRef: 'anthropic-1' });
    }
  });

  it('writes nothing', async () => {
    const before = sourcesSnapshot();
    const r = report(await planWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(r.mode).toBe('plan');
    expect(r.complete).toBe(false);
    expect(yt.creates).toBe(0);
    expect(yt.updates).toEqual([]);
    expect(yt.workspaceArticles()).toEqual([]);
    expect(sourcesSnapshot()).toEqual(before);
  });

  it('reports what it leaves behind: boards and dismissals of no workspace, and fields the schema has no place for', async () => {
    const config = legacyConfig();
    (config.workspaces[0] as Record<string, unknown>).standupScope = 'all';
    (config.workspaces[0].folders[0] as Record<string, unknown>).colour = 'teal';
    seed(config);
    const r = report(await planWorkspaceMigration(yt, SERVER));
    expect(r.notMigrated).toEqual({ boards: ['0-99'], dismissals: [dismissalKey('workspace-gone', '2-2')] });
    expect(item(r, W1).notCarried).toEqual(['folders[0].colour', 'standupScope']);
    expect(item(r, W2).notCarried).toBeUndefined();
  });

  it('accepts a source wrapped in a ```json fence', async () => {
    yt.rewrite(configId, '```json\n' + JSON.stringify(legacyConfig()) + '\n```');
    expect(report(await planWorkspaceMigration(yt, SERVER)).items).toHaveLength(3);
  });
});

// ─── Apply ───────────────────────────────────────────────────────────────────

describe('applyWorkspaceMigration', () => {
  it('creates one verified article per workspace and leaves the source articles unchanged', async () => {
    const before = sourcesSnapshot();
    const plan = report(await planWorkspaceMigration(yt, SERVER));
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.mode).toBe('apply');
    expect(r.complete).toBe(true);
    expect(r.items.map((i) => i.action)).toEqual(['created', 'created', 'created']);
    expect(yt.workspaceArticles()).toHaveLength(3);
    for (const p of plan.items) expect(yt.workspaceDoc(p.workspaceId)).toEqual(p.document);
    expect(sourcesSnapshot()).toEqual(before);
    expect(yt.updates).toEqual([]);
  });

  it('is idempotent: a second run creates nothing and reports every workspace unchanged', async () => {
    await applyWorkspaceMigration(yt, SERVER);
    const articles = yt.workspaceArticles();
    const again = report(await applyWorkspaceMigration(yt, SERVER));
    expect(again.complete).toBe(true);
    expect(again.items.map((i) => i.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(yt.workspaceArticles()).toEqual(articles);
    expect(yt.creates).toBe(3);
    expect(report(await planWorkspaceMigration(yt, SERVER)).complete).toBe(true);
  });

  it('migrates the source as it is at apply time, not as it was when planned', async () => {
    report(await planWorkspaceMigration(yt, SERVER));
    const config = legacyConfig();
    config.workspaces[0].name = 'Renamed since the plan';
    yt.rewrite(configId, JSON.stringify(config));
    report(await applyWorkspaceMigration(yt, SERVER));
    expect(yt.workspaceDoc(W1).name).toBe('Renamed since the plan');
  });

  it('reports an existing article with different content as a conflict and does not overwrite it', async () => {
    const theirs = { ...report(await planWorkspaceMigration(yt, SERVER)).items[0].document!, name: 'Edited elsewhere' };
    const existing = yt.put(workspaceArticleTitle(W1), serialiseNewWorkspaceDocument(theirs));
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(item(r, W1)).toMatchObject({ action: 'conflict', articleId: existing.id, differences: ['name'] });
    expect(yt.articles.get(existing.id)!.content).toBe(existing.content);
    expect(item(r, W2).action).toBe('created');
    expect(r.complete).toBe(false);
  });

  it('refuses a workspace with duplicate articles and leaves both alone; the others migrate', async () => {
    const d = report(await planWorkspaceMigration(yt, SERVER)).items[1].document!;
    const one = yt.put(workspaceArticleTitle(W2), serialiseNewWorkspaceDocument(d));
    const two = yt.put(workspaceArticleTitle(W2), serialiseNewWorkspaceDocument(d));
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(item(r, W2)).toMatchObject({ action: 'ambiguous', articleIds: [one.id, two.id] });
    expect(item(r, W1).action).toBe('created');
    expect(r.complete).toBe(false);
    expect(yt.articles.get(one.id)).toEqual(one);
    expect(yt.articles.get(two.id)).toEqual(two);
  });

  it('refuses a source workspace that does not make a valid document; the others migrate', async () => {
    const config = legacyConfig();
    config.workspaces[2].id = 'Not A Slug';
    seed(config);
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.items.find((i) => i.workspaceId === 'Not A Slug')).toMatchObject({ action: 'invalid-source' });
    expect(r.items.filter((i) => i.action === 'created')).toHaveLength(2);
    expect(r.complete).toBe(false);
  });

  it('is not complete when a create fails, or cannot be verified', async () => {
    yt.failCreate = true;
    let r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.items.map((i) => i.action)).toEqual(['failed', 'failed', 'failed']);
    expect(r.complete).toBe(false);

    seed();
    yt.failListAfterCreate = true;
    r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.items[0]).toMatchObject({ action: 'failed' });
    expect(r.items[0].articleId).toBeDefined(); // created, but unverified — reported, never claimed
    expect(r.complete).toBe(false);
  });

  it('never writes a credential: a secret-shaped value is refused or left behind, and never echoed', async () => {
    const secret = 'sk-ant-' + 'a'.repeat(40);
    const config = legacyConfig();
    (config.workspaces[0] as Record<string, unknown>).apiKey = secret; // a field the schema does not carry
    config.workspaces[1].name = `Workspace ${secret}`; // a known field
    seed(config);
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(item(r, W1)).toMatchObject({ action: 'created', notCarried: ['apiKey'] });
    expect(item(r, W2).action).toBe('invalid-source');
    expect(JSON.stringify(r)).not.toContain(secret);
    for (const a of yt.workspaceArticles()) expect(a.content).not.toContain(secret);
  });
});

// ─── Jira profile ────────────────────────────────────────────────────────────

describe('Jira profile', () => {
  it('without a name: reported unassigned, no workspace created, profile article untouched', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const before = sourcesSnapshot();
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.jiraProfile).toMatchObject({ status: 'unassigned' });
    expect(r.items.every((i) => i.backend === 'youtrack')).toBe(true);
    expect(yt.workspaceArticles()).toHaveLength(3);
    expect(sourcesSnapshot()).toEqual(before);
  });

  it('with a name: a separate new Jira workspace with jira-1, no Anthropic account and no projects', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const jiraArticleId = [...yt.articles.values()].find((a) => a.summary === JIRA_PROFILE_ARTICLE_TITLE)!.id;
    const r = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: '  Workspace J  ' }));
    const j = r.items.find((i) => i.backend === 'jira')!;
    expect(j.action).toBe('created');
    expect(j.workspaceId).toBe(`ws-jira-${jiraArticleId}`);
    expect(r.jiraProfile).toEqual({ status: 'assigned', articleId: jiraArticleId, workspaceId: j.workspaceId });
    expect(yt.workspaceDoc(j.workspaceId)).toMatchObject({
      name: 'Workspace J',
      order: 3,
      backend: { kind: 'jira', ...PROFILE, credentialRef: 'jira-1' },
      ai: { credentialRef: null },
      folders: [],
      boards: {},
      dismissals: {},
    });
    // The YouTrack workspaces are unchanged by it.
    expect(r.items.filter((i) => i.backend === 'youtrack').map((i) => i.document!.backend.kind)).toEqual(['youtrack', 'youtrack', 'youtrack']);
  });

  it('a second run never creates another Jira workspace, with or without the name', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' });
    const again = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(again.items.find((i) => i.backend === 'jira')!.action).toBe('unchanged');
    const noName = report(await applyWorkspaceMigration(yt, SERVER));
    // Without a name it is reported unassigned, never as migrated — the
    // earlier run's workspace is mentioned but not vouched for.
    const jiraId = again.items.find((i) => i.backend === 'jira')!.workspaceId;
    expect(noName.jiraProfile).toMatchObject({ status: 'unassigned', existingWorkspaceId: jiraId });
    expect(yt.workspaceArticles()).toHaveLength(4);
    expect(yt.creates).toBe(4);
  });

  it('an empty name is refused rather than taken as no name', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const r = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: '   ' }));
    expect(r.items.find((i) => i.backend === 'jira')).toMatchObject({ action: 'invalid-source' });
    expect(r.complete).toBe(false);
  });

  it('reports an empty, invalid or duplicated profile article and migrates no Jira workspace', async () => {
    seed(legacyConfig(), { version: 1, profile: null });
    expect(report(await planWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'J' })).jiraProfile).toMatchObject({ status: 'none' });

    seed(legacyConfig(), { version: 1, profile: { siteUrl: 'not a url', email: 'x' } });
    let r = report(await planWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'J' }));
    expect(r.jiraProfile).toMatchObject({ status: 'invalid' });
    expect(r.items.some((i) => i.backend === 'jira')).toBe(false);

    seed(legacyConfig(), { version: 1, profile: PROFILE });
    yt.put(JIRA_PROFILE_ARTICLE_TITLE, JSON.stringify({ version: 1, profile: PROFILE }));
    r = report(await planWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'J' }));
    expect(r.jiraProfile).toMatchObject({ status: 'ambiguous' });
    expect(r.items.some((i) => i.backend === 'jira')).toBe(false);
  });
});

// ─── Completion and the Jira profile ─────────────────────────────────────────
//
// `complete` is what VERM-46 activates on, so a Jira profile that should have
// migrated and did not must keep it false.

describe('completion and the Jira profile', () => {
  const jiraArticleIds = () => [...yt.articles.values()].filter((a) => a.summary === JIRA_PROFILE_ARTICLE_TITLE).map((a) => a.id);

  it('no Jira profile: completes normally', async () => {
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.jiraProfile).toEqual({ status: 'none' });
    expect(r.complete).toBe(true);
    expect(report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' })).complete).toBe(true);
  });

  it('an intentionally unassigned profile is reported as such, and does not block completion', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const r = report(await applyWorkspaceMigration(yt, SERVER));
    expect(r.jiraProfile).toMatchObject({ status: 'unassigned', articleId: jiraArticleIds()[0] });
    expect(r.jiraProfile).not.toHaveProperty('existingWorkspaceId');
    expect(r.complete).toBe(true);
  });

  it('an invalid profile never produces a complete migration, with or without a name', async () => {
    seed(legacyConfig(), { version: 1, profile: { siteUrl: 'not a url', email: 'x' } });
    for (const options of [{}, { jiraWorkspaceName: 'Workspace J' }]) {
      const r = report(await applyWorkspaceMigration(yt, SERVER, options));
      expect(r.jiraProfile.status).toBe('invalid');
      expect(r.items.every((i) => i.action === 'created' || i.action === 'unchanged')).toBe(true);
      expect(r.complete).toBe(false);
    }
    seed(legacyConfig(), '{ not json');
    yt.rewrite(jiraArticleIds()[0], '{ not json');
    expect(report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }))).toMatchObject({
      complete: false,
      jiraProfile: { status: 'invalid' },
    });
  });

  it('duplicate profile articles are detected and prevent completion, and neither is used', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    yt.put(JIRA_PROFILE_ARTICLE_TITLE, JSON.stringify({ version: 1, profile: PROFILE }));
    const r = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(r.jiraProfile).toMatchObject({ status: 'ambiguous', articleIds: jiraArticleIds().sort() });
    expect(r.items.some((i) => i.backend === 'jira')).toBe(false);
    expect(r.complete).toBe(false);
  });

  it('a supplied name requires the Jira workspace to be created and verified', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const plan = report(await planWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(plan.jiraProfile).toMatchObject({ status: 'pending' });

    // The YouTrack workspaces are already migrated; only the Jira create fails.
    await applyWorkspaceMigration(yt, SERVER);
    yt.failCreate = true;
    const failed = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(failed.items.filter((i) => i.backend === 'youtrack').every((i) => i.action === 'unchanged')).toBe(true);
    expect(failed.items.find((i) => i.backend === 'jira')).toMatchObject({ action: 'failed' });
    expect(failed.jiraProfile).toMatchObject({ status: 'failed' });
    expect(failed.complete).toBe(false);

    yt.failCreate = false;
    const ok = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(ok.jiraProfile).toMatchObject({ status: 'assigned' });
    expect(ok.complete).toBe(true);
  });

  it('a Jira workspace article that differs, or is duplicated, is not overwritten and blocks completion', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' });
    const before = yt.workspaceArticles();

    const renamed = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Another name' }));
    expect(renamed.items.find((i) => i.backend === 'jira')).toMatchObject({ action: 'conflict', differences: ['name'] });
    expect(renamed.jiraProfile).toMatchObject({ status: 'failed' });
    expect(renamed.complete).toBe(false);
    expect(yt.workspaceArticles()).toEqual(before);

    const jiraArticle = before.find((a) => a.summary.includes('ws-jira-'))!;
    yt.put(jiraArticle.summary, jiraArticle.content);
    const dup = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: 'Workspace J' }));
    expect(dup.items.find((i) => i.backend === 'jira')).toMatchObject({ action: 'ambiguous' });
    expect(dup.jiraProfile).toMatchObject({ status: 'failed' });
    expect(dup.complete).toBe(false);
  });

  it('an unusable name blocks completion rather than being taken as no name', async () => {
    seed(legacyConfig(), { version: 1, profile: PROFILE });
    const r = report(await applyWorkspaceMigration(yt, SERVER, { jiraWorkspaceName: '  ' }));
    expect(r.jiraProfile).toMatchObject({ status: 'failed' });
    expect(r.complete).toBe(false);
  });
});

// ─── Sources that cannot be migrated ─────────────────────────────────────────

describe('sources that stop migration', () => {
  async function expectStopped(reason: string) {
    for (const run of [planWorkspaceMigration, applyWorkspaceMigration]) {
      const r = await run(yt, SERVER);
      expect(r).toMatchObject({ ok: false, reason });
    }
    expect(yt.creates).toBe(0);
    expect(yt.updates).toEqual([]);
  }

  it('no _vermilian-config article', async () => {
    yt = new FakeYouTrack();
    await expectStopped('source-missing');
  });

  it('two _vermilian-config articles', async () => {
    yt.put(CONFIG_ARTICLE_TITLE, JSON.stringify(legacyConfig()));
    await expectStopped('source-ambiguous');
  });

  it('a malformed _vermilian-config is not treated as empty', async () => {
    yt.rewrite(configId, '{ not json');
    await expectStopped('source-invalid');
  });

  it('a newer _vermilian-config version', async () => {
    yt.rewrite(configId, JSON.stringify(legacyConfig({ version: 2 })));
    await expectStopped('source-unsupported');
  });

  it('the source listing fails', async () => {
    yt.failSources = true;
    await expectStopped('discovery-error');
  });
});

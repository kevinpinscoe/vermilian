import { describe, expect, it, vi } from 'vitest';
import { getWorkspaceMasterPlanState, type ArticleFetch } from './masterPlan';

// Fictional article content in the master-plan format.
const PLAN_A = '## Outcome A\n- Active epics: TEST-3\n- Success measure: the fictional thing ships\n';
const PLAN_B = '## Outcome B\n- Active epics: TEST-4\n';

function fetcher(articles: Record<string, ArticleFetch>) {
  return vi.fn(async (id: string): Promise<ArticleFetch> => articles[id] ?? { ok: false, status: 404 });
}

describe('getWorkspaceMasterPlanState', () => {
  it('is None without fetching anything when no article is referenced', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState(null, fetch)).resolves.toEqual({ kind: 'none' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads and parses exactly the referenced article, by ID', async () => {
    const fetch = fetcher({ 'VERM-A-7': { ok: true, article: { id: '161-7', content: PLAN_A, updated: 5 } } });
    const s = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    expect(fetch).toHaveBeenCalledWith('VERM-A-7');
    expect(s.kind).toBe('loaded');
    if (s.kind === 'loaded') {
      expect(s.articleId).toBe('VERM-A-7');
      expect(s.outcomes.map((o) => o.name)).toEqual(['Outcome A']);
    }
  });

  it('different workspaces referencing different articles get different plans', async () => {
    const fetch = fetcher({
      'VERM-A-7': { ok: true, article: { id: '161-7', content: PLAN_A, updated: 5 } },
      'VERM-A-8': { ok: true, article: { id: '161-8', content: PLAN_B, updated: 6 } },
    });
    const a = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    const b = await getWorkspaceMasterPlanState('VERM-A-8', fetch);
    expect(a.kind === 'loaded' && a.outcomes[0].name).toBe('Outcome A');
    expect(b.kind === 'loaded' && b.outcomes[0].name).toBe('Outcome B');
  });

  it('a missing article is reported, never replaced by a title search or the global plan', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState('VERM-A-404', fetch)).resolves.toEqual({ kind: 'reference-not-found', articleId: 'VERM-A-404' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an article the credential cannot read is reported as inaccessible', async () => {
    for (const status of [401, 403]) {
      const fetch = fetcher({ 'VERM-A-9': { ok: false, status } });
      await expect(getWorkspaceMasterPlanState('VERM-A-9', fetch)).resolves.toEqual({ kind: 'reference-inaccessible', articleId: 'VERM-A-9' });
    }
  });

  it('any other failure is reported as an error', async () => {
    const fetch = fetcher({ 'VERM-A-9': { ok: false } });
    await expect(getWorkspaceMasterPlanState('VERM-A-9', fetch)).resolves.toEqual({ kind: 'reference-error', articleId: 'VERM-A-9' });
  });

  it('an article whose content cannot be used loads with its parse diagnostics', async () => {
    const fetch = fetcher({ 'VERM-A-7': { ok: true, article: { id: '161-7', content: 'just some prose, no outcomes', updated: 5 } } });
    const s = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    expect(s.kind).toBe('loaded');
    if (s.kind === 'loaded') expect(s.parseStatus).not.toBe('valid');
  });

  it('refuses a malformed reference without fetching', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState('_vermilian-master-plan', fetch)).resolves.toEqual({ kind: 'reference-error', articleId: '' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── Active-workspace authorization (VERM-48 correction) ─────────────────────

import { getActiveWorkspaceMasterPlan, type ActiveMasterPlanDeps } from './masterPlan';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../../shared/workspaceSchema';

const wsDoc = (workspaceId: string, articleId: string | null): WorkspaceDocument => ({
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId,
  name: workspaceId,
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'https://yt.example.com', credentialRef: `youtrack-${workspaceId}` },
  ai: { credentialRef: null },
  masterPlan: { articleId },
  folders: [],
  boards: {},
  dismissals: {},
});

const DOCS: Record<string, WorkspaceDocument> = { a: wsDoc('a', 'VERM-A-7'), b: wsDoc('b', 'VERM-A-8') };

function activeDeps(activeId: string, requested: unknown, over: Partial<ActiveMasterPlanDeps> = {}) {
  let generation = 0;
  const touched: string[] = [];
  const d: ActiveMasterPlanDeps = {
    requestedWorkspaceId: requested,
    activeId,
    startGeneration: 0,
    currentGeneration: () => generation,
    loadDoc: async (id) => { touched.push(`load:${id}`); return DOCS[id] ?? null; },
    connect: async (doc) => { touched.push(`connect:${doc.workspaceId}`); return { ok: true, url: 'https://yt.example.com', token: `fictional-${doc.workspaceId}-token` }; },
    fetchArticle: async (_url, token, id) => {
      touched.push(`fetch:${id}:${token}`);
      return { ok: true, article: { id: 'x', content: id === 'VERM-A-7' ? PLAN_A : PLAN_B, updated: 1 } };
    },
    ...over,
  };
  return { d, touched, switchNow: () => { generation += 1; } };
}

describe('getActiveWorkspaceMasterPlan', () => {
  it("serves the active workspace's own plan through its own connection", async () => {
    const { d, touched } = activeDeps('a', 'a');
    const s = await getActiveWorkspaceMasterPlan(d);
    expect(s.kind === 'loaded' && s.outcomes[0].name).toBe('Outcome A');
    expect(touched).toEqual(['load:a', 'connect:a', 'fetch:VERM-A-7:fictional-a-token']);
  });

  it('with no workspace named, serves the active one', async () => {
    const { d } = activeDeps('b', undefined);
    const s = await getActiveWorkspaceMasterPlan(d);
    expect(s.kind === 'loaded' && s.outcomes[0].name).toBe('Outcome B');
  });

  it('refuses a request for an inactive workspace before reading anything', async () => {
    const { d, touched } = activeDeps('a', 'b');
    await expect(getActiveWorkspaceMasterPlan(d)).resolves.toEqual({ kind: 'workspace-not-active' });
    expect(touched).toEqual([]);
  });

  it('a switch before the article is read stops it: YouTrack is not contacted', async () => {
    const box = activeDeps('a', 'a');
    box.d.connect = async (doc) => { box.switchNow(); return { ok: true, url: 'u', token: `fictional-${doc.workspaceId}-token` }; };
    await expect(getActiveWorkspaceMasterPlan(box.d)).resolves.toEqual({ kind: 'workspace-not-active' });
    expect(box.touched.some((t) => t.startsWith('fetch:'))).toBe(false);
  });

  it('a switch while the article is being read discards it: the old plan is never returned', async () => {
    const box = activeDeps('a', 'a');
    const original = box.d.fetchArticle;
    box.d.fetchArticle = async (url, token, id) => { const r = await original(url, token, id); box.switchNow(); return r; };
    await expect(getActiveWorkspaceMasterPlan(box.d)).resolves.toEqual({ kind: 'workspace-not-active' });
  });

  it('a connection that cannot be made is a safe error, with no fallback read', async () => {
    const { d, touched } = activeDeps('a', 'a', { connect: async () => ({ ok: false, error: 'YouTrack is unavailable for this workspace: …' }) });
    await expect(getActiveWorkspaceMasterPlan(d)).resolves.toEqual({ kind: 'reference-error', articleId: 'VERM-A-7' });
    expect(touched.some((t) => t.startsWith('fetch:'))).toBe(false);
  });

  it('None, Jira and missing workspaces still behave as before, without a connection', async () => {
    const connect = vi.fn();
    const none = activeDeps('n', 'n', { connect, loadDoc: async () => wsDoc('n', null) });
    await expect(getActiveWorkspaceMasterPlan(none.d)).resolves.toEqual({ kind: 'none' });
    const jiraDoc = { ...wsDoc('j', null), backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'u@example.com', cloudId: '', credentialRef: 'jira-1' } };
    const jira = activeDeps('j', 'j', { connect, loadDoc: async () => jiraDoc });
    await expect(getActiveWorkspaceMasterPlan(jira.d)).resolves.toEqual({ kind: 'none' });
    const gone = activeDeps('gone', 'gone', { connect });
    await expect(getActiveWorkspaceMasterPlan(gone.d)).resolves.toEqual({ kind: 'none' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('missing and inaccessible articles keep their diagnostics', async () => {
    for (const [status, kind] of [[404, 'reference-not-found'], [403, 'reference-inaccessible']] as const) {
      const { d } = activeDeps('a', 'a', { fetchArticle: async () => ({ ok: false, status }) });
      await expect(getActiveWorkspaceMasterPlan(d)).resolves.toEqual({ kind, articleId: 'VERM-A-7' });
    }
  });
});

/**
 * Stand-ups cover the active workspace only, and each workspace has its own
 * master plan or none (VERM-48), against the fake YouTrack, Jira and Claude.
 *
 * The fake YouTrack records which projects each stand-up asked for, can hold
 * a stand-up while its issues load, and serves master-plan articles by
 * readable ID (VERM-A-90 is the global plan the env vars seed). Migration is
 * only ever planned here — a read-only dry run against the fake; nothing is
 * migrated or activated. Every value is fictional.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const PLAN_HOME = '## Ship the home outcome\n- Active epics: TEST-3\n';
const PLAN_WORK = '## Close the work outcome\n- Active epics: TEST-4\n';

const yt = (workspaceId: string, name: string, order: number, projectIds: string[], masterPlan: string | null, ytRef = `youtrack-${workspaceId.slice(-1)}x`): WorkspaceDocument => ({
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId,
  name,
  order,
  // Every workspace on the same server, each with its own YouTrack reference.
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: ytRef },
  ai: { credentialRef: 'anthropic-e2e' },
  masterPlan: { articleId: masterPlan },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds }],
  boards: {},
  dismissals: {},
});

const SEEDS: WorkspaceDocument[] = [
  yt('ws-e2esm1', 'Home SM', 0, ['0-e1'], 'VERM-A-90', 'youtrack-home'),
  yt('ws-e2esm2', 'Work SM', 1, ['0-e2'], 'VERM-A-200', 'youtrack-work'),
  yt('ws-e2esm3', 'No plan SM', 2, ['0-e1', '0-e3'], null),
  yt('ws-e2esm4', 'Missing plan SM', 3, ['0-e1'], 'VERM-A-404'),
  yt('ws-e2esm5', 'Locked plan SM', 4, ['0-e1'], 'VERM-A-403'),
  // A YouTrack reference whose configured source fails, and one with no
  // source on this machine at all.
  yt('ws-e2esm7', 'Broken YT SM', 6, ['0-e1'], 'VERM-A-90', 'youtrack-broken'),
  yt('ws-e2esm8', 'Missing YT SM', 7, ['0-e1'], 'VERM-A-90', 'e2e-missing-yt'),
  {
    ...yt('ws-e2esm6', 'Jira SM', 5, ['DEMO'], null),
    backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  },
];

let app: ElectronApplication;
let page: Page;

const standupQueries = () => page.evaluate(() => window.vermilian.debugGetStandupQueries!());
const standupRefs = () => page.evaluate(() => window.vermilian.debugGetStandupCredentialRefs!());
const articleFetches = () => page.evaluate(() => window.vermilian.debugGetArticleFetches!());
const claudeCalls = () => page.evaluate(() => window.vermilian.debugGetClaudeCalls!());

async function activate(workspaceId: string) {
  const r = await page.evaluate((id) => window.vermilian.setActiveWorkspace(id), workspaceId);
  expect(r.ok).toBe(true);
}

async function openSwitcherWorkspace(name: string) {
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
  await expect(tid(page, 'workspace-switcher')).toContainText(name);
}

async function readDoc(workspaceId: string): Promise<WorkspaceDocument> {
  const r = await page.evaluate((id) => window.vermilian.readWorkspaceArticle(id), workspaceId);
  if (!r.ok || r.entry.status !== 'ok') throw new Error('workspace article not readable');
  return r.entry.document;
}

test.describe('per-workspace storage (e2e gate)', () => {
  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_MASTER_PLAN_CONTENT: PLAN_HOME,
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const d of SEEDS) {
      const r = await page.evaluate((doc) => window.vermilian.createWorkspaceArticle(doc), d);
      expect(r.ok).toBe(true);
    }
    await page.evaluate((c) => window.vermilian.debugSetArticle!('VERM-A-200', { content: c }), PLAN_WORK);
    await page.evaluate(() => window.vermilian.debugSetArticle!('VERM-A-403', { status: 403 }));
    await page.evaluate(() => window.vermilian.setCredentialRefSources('youtrack-broken', { command: '', file: '/nonexistent/vermilian-e2e/yt.token' }));
    await page.reload();
    await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  // ─── Stand-ups ───────────────────────────────────────────────────────────

  test("a stand-up covers only the active workspace's projects, and any scope a caller sends is ignored", async () => {
    for (const [id, expected] of [['ws-e2esm1', ['TEST']], ['ws-e2esm2', ['TST2']], ['ws-e2esm3', ['TEST', 'INB']]] as const) {
      await activate(id);
      const before = (await standupQueries()).length;
      const r = await page.evaluate(
        (wid) => window.vermilian.standupGenerate({ window: '7d', workspaceId: wid, scope: 'all-workspace', customWorkspaceIds: ['ws-e2esm1', 'ws-e2esm2'] } as never),
        id,
      );
      expect(r.ok).toBe(true);
      expect((await standupQueries()).slice(before)).toEqual([expected]);
    }
  });

  test("two workspaces on the same server each read YouTrack with their own credential", async () => {
    for (const [id, ref] of [['ws-e2esm1', 'youtrack-home'], ['ws-e2esm2', 'youtrack-work']] as const) {
      await activate(id);
      const before = (await standupRefs()).length;
      const r = await page.evaluate((wid) => window.vermilian.standupGenerate({ window: '7d', workspaceId: wid }), id);
      expect(r.ok).toBe(true);
      expect((await standupRefs()).slice(before)).toEqual([ref]);
    }
  });

  test('a YouTrack credential that fails or is missing stops the stand-up before any YouTrack read, with no fallback', async () => {
    for (const [id, pattern] of [['ws-e2esm7', /youtrack-broken/], ['ws-e2esm8', /e2e-missing-yt .*has no source configured/]] as const) {
      await activate(id);
      const beforeQ = (await standupQueries()).length;
      const beforeC = (await claudeCalls()).length;
      const r = await page.evaluate((wid) => window.vermilian.standupGenerate({ window: '7d', workspaceId: wid }), id);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(pattern);
      expect(r.error).not.toContain('/nonexistent/');
      expect((await standupQueries()).length).toBe(beforeQ);
      expect((await claudeCalls()).length).toBe(beforeC);
    }
  });

  test('switching workspaces while the stand-up loads its issues refuses it before Anthropic is contacted', async () => {
    await activate('ws-e2esm1');
    await page.evaluate(() => window.vermilian.debugSetStandupDelay!(2000));
    const before = (await claudeCalls()).length;
    await page.evaluate("window.__standup = window.vermilian.standupGenerate({ window: '7d', workspaceId: 'ws-e2esm1' }); void 0");
    await expect.poll(async () => (await standupQueries()).length).toBeGreaterThan(0); // issues are loading
    await activate('ws-e2esm2');
    const r = (await page.evaluate('window.__standup')) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/active workspace changed/);
    expect((await claudeCalls()).length).toBe(before);
  });

  test('the stand-up modal names the active workspace and offers no scope choice', async () => {
    await openSwitcherWorkspace('Work SM');
    await tid(page, 'standup-btn').click();
    await expect(tid(page, 'standup-workspace')).toContainText('Work SM');
    await expect(page.locator('input[name="standup-scope"]')).toHaveCount(0);
    await expect(page.getByText('All workspaces')).toHaveCount(0);
  });

  test('a Jira workspace cannot generate a stand-up: the control is disabled and the call refused', async () => {
    await openSwitcherWorkspace('Jira SM');
    await expect(tid(page, 'standup-btn')).toBeDisabled();
    const beforeQ = (await standupQueries()).length;
    const beforeC = (await claudeCalls()).length;
    const r = await page.evaluate(() => window.vermilian.standupGenerate({ window: '7d', workspaceId: 'ws-e2esm6' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available for Jira workspaces/);
    expect((await standupQueries()).length).toBe(beforeQ);
    expect((await claudeCalls()).length).toBe(beforeC);
    await openSwitcherWorkspace('Home SM');
    await expect(tid(page, 'standup-btn')).toBeEnabled();
  });

  // ─── Master plans ────────────────────────────────────────────────────────

  test('each workspace reads its own master plan by article ID, or none', async () => {
    const state = async (id: string) => {
      await activate(id);
      return page.evaluate((wid) => window.vermilian.getMasterPlan(wid), id);
    };
    const home = await state('ws-e2esm1');
    expect(home.kind === 'loaded' && home.outcomes.map((o) => o.name)).toEqual(['Ship the home outcome']);
    const work = await state('ws-e2esm2');
    expect(work.kind === 'loaded' && work.outcomes.map((o) => o.name)).toEqual(['Close the work outcome']);
    expect(await state('ws-e2esm3')).toEqual({ kind: 'none' });
    expect(await state('ws-e2esm4')).toEqual({ kind: 'reference-not-found', articleId: 'VERM-A-404' });
    expect(await state('ws-e2esm5')).toEqual({ kind: 'reference-inaccessible', articleId: 'VERM-A-403' });
    expect(await state('ws-e2esm6')).toEqual({ kind: 'none' });
    // Read with each workspace's own YouTrack reference.
    const fetched = await articleFetches();
    expect(fetched.find((f) => f.articleId === 'VERM-A-90')?.credentialRef).toBe('youtrack-home');
    expect(fetched.find((f) => f.articleId === 'VERM-A-200')?.credentialRef).toBe('youtrack-work');
  });

  test('a request for an inactive workspace is refused without contacting YouTrack', async () => {
    await activate('ws-e2esm1');
    const before = (await articleFetches()).length;
    expect(await page.evaluate(() => window.vermilian.getMasterPlan('ws-e2esm2'))).toEqual({ kind: 'workspace-not-active' });
    expect((await articleFetches()).length).toBe(before);
    // The active one still works.
    const own = await page.evaluate(() => window.vermilian.getMasterPlan('ws-e2esm1'));
    expect(own.kind).toBe('loaded');
  });

  test("a switch during a delayed master-plan read never returns the previous workspace's plan", async () => {
    await activate('ws-e2esm1');
    await page.evaluate(() => window.vermilian.debugSetArticleDelay!(1500));
    const before = (await articleFetches()).length;
    await page.evaluate("window.__plan = window.vermilian.getMasterPlan('ws-e2esm1'); void 0");
    await expect.poll(async () => (await articleFetches()).length).toBeGreaterThan(before); // the read is in flight
    await activate('ws-e2esm2');
    expect(await page.evaluate('window.__plan')).toEqual({ kind: 'workspace-not-active' });
    await page.evaluate(() => window.vermilian.debugSetArticleDelay!(0));
    const work = await page.evaluate(() => window.vermilian.getMasterPlan('ws-e2esm2'));
    expect(work.kind === 'loaded' && work.outcomes.map((o) => o.name)).toEqual(['Close the work outcome']);
  });

  test('a master plan whose workspace YouTrack credential fails is a safe error, never a fallback read', async () => {
    await activate('ws-e2esm7');
    const before = (await articleFetches()).length;
    expect(await page.evaluate(() => window.vermilian.getMasterPlan('ws-e2esm7'))).toEqual({ kind: 'reference-error', articleId: 'VERM-A-90' });
    expect((await articleFetches()).length).toBe(before);
  });

  test("the Priority Desk's master plan follows the active workspace", async () => {
    await openSwitcherWorkspace('Missing plan SM');
    await tid(page, 'nav-priority-desk').click();
    await expect(tid(page, 'master-plan-diagnostic-banner')).toContainText('VERM-A-404');
    await openSwitcherWorkspace('No plan SM');
    await expect(tid(page, 'master-plan-diagnostic-banner')).toHaveCount(0);
    await openSwitcherWorkspace('Locked plan SM');
    await expect(tid(page, 'master-plan-diagnostic-banner')).toContainText('not allowed to read VERM-A-403');
    // Each workspace keeps its own cached result: back to the first, its banner returns.
    await openSwitcherWorkspace('Missing plan SM');
    await expect(tid(page, 'master-plan-diagnostic-banner')).toContainText('VERM-A-404');
  });

  test('Manage workspaces sets, changes and clears a master plan, keeping every other setting', async () => {
    const id = 'ws-e2esm3';
    const before = await readDoc(id);
    const open = async () => {
      await tid(page, 'workspace-switcher').click();
      await tid(page, 'manage-workspaces-btn').click();
      await page.locator('[data-testid="workspace-row"][data-ws-name="No plan SM"] [data-testid="workspace-master-plan-btn"]').click();
      await expect(tid(page, 'workspace-master-plan-current')).toBeVisible();
    };
    for (const value of ['verm-a-200', 'VERM-A-90']) {
      await open();
      await tid(page, 'workspace-master-plan-input').fill(value);
      await tid(page, 'workspace-master-plan-save').click();
      await expect(page.locator('#workspace-master-plan-modal')).toHaveCount(0);
      await expect.poll(async () => (await readDoc(id)).masterPlan?.articleId).toBe(value.toUpperCase());
    }
    await open();
    await expect(tid(page, 'workspace-master-plan-current')).toHaveText('Current: VERM-A-90');
    await tid(page, 'workspace-master-plan-input').fill('_vermilian-master-plan');
    await tid(page, 'workspace-master-plan-save').click();
    await expect(tid(page, 'workspace-master-plan-save-error')).toContainText('article ID');
    await tid(page, 'workspace-master-plan-none').click();
    await expect.poll(async () => (await readDoc(id)).masterPlan?.articleId).toBeNull();
    const after = await readDoc(id);
    expect({ ...after, masterPlan: before.masterPlan }).toEqual(before);
  });

  test('a Jira workspace is told it has no master plan, and offered no control to set one', async () => {
    await tid(page, 'workspace-switcher').click();
    await tid(page, 'manage-workspaces-btn').click();
    await page.locator('[data-testid="workspace-row"][data-ws-name="Jira SM"] [data-testid="workspace-master-plan-btn"]').click();
    await expect(tid(page, 'workspace-master-plan-jira')).toBeVisible();
    await expect(tid(page, 'workspace-master-plan-input')).toHaveCount(0);
  });

  test('a new workspace starts with no master plan', async () => {
    await tid(page, 'workspace-switcher').click();
    await tid(page, 'new-workspace-btn').click();
    await tid(page, 'new-workspace-input').fill('Fresh SM');
    await tid(page, 'new-workspace-backend-youtrack').click();
    await tid(page, 'new-workspace-server-url').fill('http://e2e.local');
    await tid(page, 'new-workspace-submit').click();
    await expect(tid(page, 'workspace-switcher')).toContainText('Fresh SM');
    const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
    if (!listed.ok) throw new Error(listed.message);
    const doc = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : [])).find((d) => d.name === 'Fresh SM');
    expect(doc?.masterPlan).toEqual({ articleId: null });
  });
});

// ─── Legacy storage, before VERM-53 ────────────────────────────────────────

const LEGACY_CONFIG = {
  version: 1,
  activeWorkspaceId: 'workspace-a',
  workspaces: [
    { id: 'workspace-a', name: 'Legacy A', order: 0, folders: [{ id: 'f-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }] },
    { id: 'workspace-b', name: 'Legacy B', order: 1, folders: [{ id: 'f-b', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e2', '0-e3'] }] },
  ],
  boards: {},
  dismissals: {},
};

test.describe('legacy storage (before VERM-53 activation)', () => {
  test.afterEach(async () => { await app.close(); });

  test('stand-ups cover the active legacy workspace only; the global master plan is unchanged', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(LEGACY_CONFIG),
      VERMILIAN_E2E_MASTER_PLAN_CONTENT: PLAN_HOME,
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const [id, expected] of [['workspace-a', ['TEST']], ['workspace-b', ['TST2', 'INB']]] as const) {
      await activate(id);
      const before = (await standupQueries()).length;
      const r = await page.evaluate((wid) => window.vermilian.standupGenerate({ window: '7d', workspaceId: wid, scope: 'all-workspace' } as never), id);
      expect(r.ok).toBe(true);
      expect((await standupQueries()).slice(before)).toEqual([expected]);
    }
    // Every legacy workspace still sees the one global plan, found by title.
    for (const id of ['workspace-a', 'workspace-b']) {
      const s = await page.evaluate((wid) => window.vermilian.getMasterPlan(wid), id);
      expect(s.kind === 'loaded' && s.outcomes.map((o) => o.name)).toEqual(['Ship the home outcome']);
    }
  });

  test('a migration dry run gives YouTrack workspaces the global plan by ID; nothing is written', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(LEGACY_CONFIG),
      VERMILIAN_E2E_MASTER_PLAN_CONTENT: PLAN_HOME,
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const sourcesBefore = await page.evaluate(() => window.vermilian.debugGetMigrationSources!());
    const r = await page.evaluate(() => window.vermilian.planWorkspaceMigration());
    if (!r.ok) throw new Error(r.message);
    expect(r.mode).toBe('plan');
    expect(r.masterPlanArticleId).toBe('VERM-A-90');
    for (const i of r.items) expect(i.document!.masterPlan).toEqual({ articleId: 'VERM-A-90' });
    expect(await page.evaluate(() => window.vermilian.debugGetMigrationSources!())).toEqual(sourcesBefore);
    expect(await page.evaluate(() => window.vermilian.debugGetWorkspaceArticles!())).toEqual([]);
  });

  test('a migration dry run stops when the global plan is ambiguous', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(LEGACY_CONFIG),
      VERMILIAN_E2E_MASTER_PLAN_DUPLICATE: '1',
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const r = await page.evaluate(() => window.vermilian.planWorkspaceMigration());
    expect(r).toMatchObject({ ok: false, reason: 'master-plan-ambiguous' });
    expect(await page.evaluate(() => window.vermilian.debugGetWorkspaceArticles!())).toEqual([]);
  });
});

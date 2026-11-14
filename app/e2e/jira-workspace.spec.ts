/**
 * Creating a workspace with an explicit backend, and choosing a Jira
 * workspace's projects (VERM-33), against the fake YouTrack and fake Jira.
 *
 * Per-workspace storage is the e2e stand-in for the activation gate VERM-53
 * owns (VERMILIAN_E2E_WORKSPACE_STORAGE=per-workspace); only it can hold a
 * Jira workspace. Legacy storage offers YouTrack alone. Neither has a default
 * backend: Create stays disabled until one is chosen.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const switcher = (page: Page) => page.locator('[data-testid="workspace-switcher"]');
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function openNewWorkspaceForm(page: Page, name: string) {
  await switcher(page).click();
  await tid(page, 'new-workspace-btn').click();
  await tid(page, 'new-workspace-input').fill(name);
}

test.describe('New workspace — legacy storage', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('Create waits for an explicit backend; Jira is not offered without per-workspace storage', async () => {
    await openNewWorkspaceForm(page, 'Choose first');
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await expect(tid(page, 'new-workspace-backend-jira')).toBeDisabled();
    await expect(tid(page, 'new-workspace-backend-youtrack')).toHaveAttribute('aria-checked', 'false');

    await tid(page, 'new-workspace-backend-youtrack').click();
    await expect(tid(page, 'new-workspace-backend-youtrack')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'new-workspace-submit')).toBeEnabled();
    await tid(page, 'new-workspace-submit').click();
    await expect(switcher(page)).toContainText('Choose first');
  });
});

// Fictional values only (ADR-0011 §10).
const SEED: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2eyt1',
  name: 'Workspace A',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
};

async function readAllWorkspaces(page: Page): Promise<WorkspaceDocument[]> {
  const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
  if (!listed.ok) throw new Error(listed.message);
  return listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
}

test.describe('New workspace and Jira projects — per-workspace storage (e2e gate)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), SEED);
    expect(r.ok).toBe(true);
    await page.reload();
    await expect(switcher(page)).toContainText('Workspace A', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('creates a Jira workspace and picks a Jira project', async () => {
    await openNewWorkspaceForm(page, 'Work');
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await tid(page, 'new-workspace-backend-jira').click();
    // Jira needs its site and account before Create is enabled.
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await tid(page, 'new-workspace-site-url').fill('https://example.atlassian.net');
    await tid(page, 'new-workspace-email').fill('user@example.com');
    await expect(tid(page, 'new-workspace-credential-ref')).toHaveValue('jira-1');
    await tid(page, 'new-workspace-submit').click();

    await expect(switcher(page)).toContainText('Work');
    await expect(tid(page, 'workspace-backend')).toHaveText('Jira · example.atlassian.net');
    await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects chosen yet.');

    const created = (await readAllWorkspaces(page)).find((d) => d.name === 'Work')!;
    expect(created.backend).toEqual({ kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' });
    expect(created.order).toBe(1);

    // The picker lists the fake Jira's projects through the workspace's own connection.
    await tid(page, 'choose-jira-projects-btn').click();
    const rows = tid(page, 'jira-projects-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-project-key', 'DEMO');
    await rows.filter({ has: page.locator('input') }).nth(0).locator('input').check();
    await tid(page, 'jira-projects-save').click();
    await expect(page.locator('#jira-projects-modal')).toHaveCount(0);

    await expect(tid(page, 'jira-workspace-projects')).toHaveText('Jira projects: DEMO');
    const saved = (await readAllWorkspaces(page)).find((d) => d.workspaceId === created.workspaceId)!;
    expect(saved.folders.flatMap((f) => f.projectIds)).toEqual(['DEMO']);
    expect(saved.backend.kind).toBe('jira');

    // Reopening shows the saved selection.
    await tid(page, 'choose-jira-projects-btn').click();
    await expect(page.locator('[data-project-key="DEMO"] input')).toBeChecked();
    await expect(page.locator('[data-project-key="OPS"] input')).not.toBeChecked();
  });

  test('a new YouTrack workspace takes the configured server, and its backend stays YouTrack', async () => {
    await openNewWorkspaceForm(page, 'Home 2');
    await tid(page, 'new-workspace-backend-youtrack').click();
    await expect(tid(page, 'new-workspace-server-url')).toHaveValue('http://e2e.local');
    await expect(tid(page, 'new-workspace-credential-ref')).toHaveValue('youtrack-1');
    await tid(page, 'new-workspace-submit').click();
    await expect(switcher(page)).toContainText('Home 2');
    await expect(tid(page, 'workspace-backend')).toHaveText('YouTrack · e2e.local');
    // No Jira picker on a YouTrack workspace.
    await expect(tid(page, 'choose-jira-projects-btn')).toHaveCount(0);
  });

  test('changing the backend of a workspace that has projects is refused, and nothing is lost', async () => {
    const jiraWs = (await page.evaluate(
      (d) => window.vermilian.createWorkspaceArticle(d),
      {
        ...SEED,
        workspaceId: 'ws-e2ejr9',
        name: 'Jira one',
        order: 1,
        backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
        folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
      },
    ));
    expect(jiraWs.ok).toBe(true);
    const base = (await readAllWorkspaces(page)).find((d) => d.workspaceId === 'ws-e2ejr9')!;
    const r = await page.evaluate(
      ([b, e]) => window.vermilian.updateWorkspaceArticle(b, e),
      [base, { ...base, backend: SEED.backend }] as const,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/would discard them/);
    const after = (await readAllWorkspaces(page)).find((d) => d.workspaceId === 'ws-e2ejr9')!;
    expect(after.backend.kind).toBe('jira');
    expect(after.folders.flatMap((f) => f.projectIds)).toEqual(['DEMO']);
  });
});

/**
 * Hiding chosen status columns on a Jira workspace board (VERM-60), against
 * the fake YouTrack and fake Jira. With DEMO and OPS chosen the board has
 * three columns: To Do (DEMO-102), In Progress (DEMO-101), Waiting (OPS-7).
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const toggle = (page: Page, status: string) => page.locator(`[data-testid="jira-column-toggle"][data-status="${status}"]`);

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
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

const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-e2ejh1',
  name: 'Jira columns',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
};

async function columnNames(page: Page): Promise<string[]> {
  return tid(page, 'jira-column').evaluateAll((els) => els.map((e) => e.getAttribute('data-status') ?? ''));
}

async function savedHidden(page: Page): Promise<string[] | undefined> {
  const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
  if (!listed.ok) throw new Error(listed.message);
  const doc = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : [])).find((d) => d.workspaceId === 'ws-e2ejh1');
  return doc?.jiraHiddenStatuses;
}

async function openJiraBoard(page: Page) {
  await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira columns' }).click();
  await expect(tid(page, 'jira-card')).toHaveCount(3, { timeout: 15_000 });
}

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const doc of [YT, JIRA]) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await openJiraBoard(page);
});
test.afterEach(async () => { await app.close(); });

test('hiding a column removes it, counts its issues, and is saved to the workspace', async () => {
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect(tid(page, 'jira-hidden-columns')).toHaveCount(0);

  await tid(page, 'jira-columns-btn').click();
  await expect(toggle(page, 'Waiting')).toBeChecked();
  await toggle(page, 'Waiting').uncheck();
  await tid(page, 'jira-columns-save').click();

  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress']);
  await expect(tid(page, 'jira-hidden-columns')).toHaveText('1 hidden: Waiting (1)');
  await expect(page.locator('[data-testid="jira-card"][data-issue-key="OPS-7"]')).toHaveCount(0);
  // Its issue is still loaded: the total does not drop.
  await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
  await expect.poll(() => savedHidden(page)).toEqual(['Waiting']);

  // The choice survives a reload, because it lives in the workspace article.
  await page.reload();
  // The Jira workspace stays the active one across a reload.
  await expect(tid(page, 'workspace-switcher')).toContainText('Jira columns', { timeout: 15_000 });
  await expect(tid(page, 'jira-card')).toHaveCount(2, { timeout: 15_000 });
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress']);
  await expect(tid(page, 'jira-hidden-columns')).toHaveText('1 hidden: Waiting (1)');
});

test('a hidden column can be shown again, which clears the saved choice', async () => {
  await tid(page, 'jira-columns-btn').click();
  await toggle(page, 'Waiting').uncheck();
  await toggle(page, 'To Do').uncheck();
  await tid(page, 'jira-columns-save').click();
  await expect(tid(page, 'jira-hidden-columns')).toHaveText('2 hidden: To Do (1), Waiting (1)');

  await tid(page, 'jira-columns-btn').click();
  await expect(toggle(page, 'Waiting')).not.toBeChecked();
  await toggle(page, 'Waiting').check();
  await toggle(page, 'To Do').check();
  await tid(page, 'jira-columns-save').click();

  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect(tid(page, 'jira-hidden-columns')).toHaveCount(0);
  await expect.poll(() => savedHidden(page)).toBeUndefined();
});

test('Cancel leaves the board unchanged', async () => {
  await tid(page, 'jira-columns-btn').click();
  await toggle(page, 'Waiting').uncheck();
  await page.locator('[data-testid="jira-columns-menu"] >> text=Cancel').click();
  await expect(tid(page, 'jira-columns-menu')).toHaveCount(0);
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  expect(await savedHidden(page)).toBeUndefined();
});

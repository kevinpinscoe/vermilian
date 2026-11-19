/**
 * The Status filter on a Jira workspace board (VERM-67), against the fake
 * YouTrack and fake Jira. DEMO defines To Do, In Progress, In Review and Done;
 * OPS defines Waiting and Done. Open issues sit in To Do (DEMO-102),
 * In Progress (DEMO-101) and Waiting (OPS-7).
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const pill = (page: Page, status: string) => page.locator(`[data-testid="jira-status-pill"][data-status="${status}"]`);

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
  workspaceId: 'ws-e2ejs1',
  name: 'Jira statuses',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
};

const READS = new Set([
  'detectCloudId', 'getMyself', 'probeJiraToken', 'jiraApiBase', 'searchJql', 'getIssue', 'listProjects',
  'searchProjectIssues', 'searchProjectRecentlyUpdated', 'getEditMeta', 'getIssueComments',
  'listBoards', 'searchBoardIssues', 'listProjectStatuses',
]);

async function columnNames(page: Page): Promise<string[]> {
  return tid(page, 'jira-column').evaluateAll((els) => els.map((e) => e.getAttribute('data-status') ?? ''));
}

async function savedHidden(page: Page): Promise<string[] | undefined> {
  const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
  if (!listed.ok) throw new Error(listed.message);
  const doc = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : [])).find((d) => d.workspaceId === 'ws-e2ejs1');
  return doc?.jiraHiddenStatuses;
}

async function openJiraBoard(page: Page) {
  await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira statuses' }).click();
  await expect(tid(page, 'jira-card')).toHaveCount(3, { timeout: 15_000 });
}

let app: ElectronApplication;
let page: Page;

async function launch(seed: WorkspaceDocument[] = [YT, JIRA]) {
  app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const doc of seed) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
    expect(r.ok).toBe(true);
  }
}

test.afterEach(async () => { await app.close(); });

test('lists every status, including ones with no loaded issue', async () => {
  await launch();
  await page.reload();
  await openJiraBoard(page);
  await expect.poll(() => tid(page, 'jira-status-pill').evaluateAll((els) => els.map((e) => e.getAttribute('data-status'))))
    .toEqual(['To Do', 'In Progress', 'Waiting', 'Done', 'In Review']);
  await expect(tid(page, 'jira-status-list-note')).toHaveCount(0);
});

test('a status can be turned off and on, is saved, and never writes to Jira', async () => {
  await launch();
  await page.reload();
  await openJiraBoard(page);

  await expect(pill(page, 'Waiting')).toHaveAttribute('aria-pressed', 'true');
  await pill(page, 'Waiting').click();
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress']);
  await expect(pill(page, 'Waiting')).toHaveAttribute('aria-pressed', 'false');
  await expect(tid(page, 'jira-hidden-columns')).toHaveText('1 hidden: Waiting (1)');
  await expect.poll(() => savedHidden(page)).toEqual(['Waiting']);

  // A status with no issues can be hidden in advance.
  await expect(pill(page, 'In Review')).toBeEnabled();
  await pill(page, 'In Review').click();
  await expect.poll(() => savedHidden(page)).toEqual(['Waiting', 'In Review']);

  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toContainText('Jira statuses', { timeout: 15_000 });
  await expect.poll(() => columnNames(page), { timeout: 15_000 }).toEqual(['To Do', 'In Progress']);

  await expect(pill(page, 'Waiting')).toBeEnabled();
  await pill(page, 'Waiting').click();
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect.poll(() => savedHidden(page)).toEqual(['In Review']);

  const fns = new Set((await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).map((c) => c.fn));
  expect([...fns].filter((f) => !READS.has(f))).toEqual([]);
});

test('In Progress is locked on, even against a saved choice', async () => {
  await launch([YT, { ...JIRA, jiraHiddenStatuses: ['In Progress'] }]);
  await page.reload();
  await openJiraBoard(page);

  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect(pill(page, 'In Progress')).toBeDisabled();
  await expect(pill(page, 'In Progress')).toHaveAttribute('aria-pressed', 'true');
  await expect(tid(page, 'jira-hidden-columns')).toHaveCount(0);

  await tid(page, 'jira-columns-btn').click();
  await expect(page.locator('[data-testid="jira-column-toggle"][data-status="In Progress"]')).toBeDisabled();
  await expect(page.locator('[data-testid="jira-column-toggle"][data-status="In Progress"]')).toBeChecked();
});

test('the In Progress column shows when no issue is in it', async () => {
  await launch();
  await page.evaluate(() => window.vermilian.debugJiraChange!({ op: 'edit', key: 'DEMO-101', status: { name: 'To Do', category: 'new' } }));
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira statuses' }).click();
  await expect(tid(page, 'jira-card')).toHaveCount(3, { timeout: 15_000 });

  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect(page.locator('[data-testid="jira-column"][data-status="In Progress"] [data-testid="jira-column-count"]')).toHaveText('0');
});

test('a token that cannot read statuses falls back to the loaded ones and says so', async () => {
  await launch();
  await page.evaluate(() => window.vermilian.debugJiraChange!({ op: 'failStatusReads' }));
  await page.reload();
  await openJiraBoard(page);

  await expect(tid(page, 'jira-status-list-note')).toBeVisible();
  await expect.poll(() => tid(page, 'jira-status-pill').evaluateAll((els) => els.map((e) => e.getAttribute('data-status'))))
    .toEqual(['To Do', 'In Progress', 'Waiting']);
  await expect.poll(() => columnNames(page)).toEqual(['To Do', 'In Progress', 'Waiting']);
});

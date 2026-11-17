/**
 * Board search above the kanban (VERM-61) and the Assignee filter on Jira
 * boards (VERM-62), against the fake YouTrack and fake Jira.
 *
 * Fake Jira (src/main/api/fakeJira.ts): DEMO-101 "Rotate the staging database
 * credentials" (In Progress, assigned to the workspace's own account), DEMO-102
 * "Document the on-call handover" (To Do, Dana Ops), OPS-7 "Review alert
 * thresholds" (Waiting, unassigned), and DEMO-109 "Archive the legacy runbook",
 * which is Done — off the board while Show done is off, so only a backend
 * search can find it.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const assigneePill = (page: Page, value: string) =>
  page.locator(`[data-testid="ws-filter-pill"][data-section="Assignee"][data-value="${value}"]`);

async function visibleCardKeys(page: Page): Promise<string[]> {
  const keys = await tid(page, 'jira-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-key') ?? ''));
  return keys.sort();
}

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
  name: 'Jira search',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
};

async function openJiraBoard(extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace', ...extraEnv });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const doc of [YT, JIRA]) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira search' }).click();
  return { app, page };
}

test.describe('Jira board search and Assignee filter', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    ({ app, page } = await openJiraBoard());
    await expect(tid(page, 'jira-card')).toHaveCount(3, { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('typing filters the loaded cards by summary or key, with N of M counts', async () => {
    await tid(page, 'board-search-input').fill('rotate');
    await expect.poll(() => visibleCardKeys(page)).toEqual(['DEMO-101']);
    await expect(tid(page, 'jira-issue-count')).toHaveText('1 of 3 issues');
    // Every column stays, so the board keeps its shape.
    await expect(tid(page, 'jira-column')).toHaveCount(3);
    await expect(page.locator('[data-testid="jira-column"][data-status="In Progress"] [data-testid="jira-column-count"]')).toHaveText('1 of 1');
    await expect(page.locator('[data-testid="jira-column"][data-status="To Do"] [data-testid="jira-column-count"]')).toHaveText('0 of 1');

    await tid(page, 'board-search-input').fill('ops-7');
    await expect.poll(() => visibleCardKeys(page)).toEqual(['OPS-7']);

    await tid(page, 'board-search-input').press('Escape');
    await expect(tid(page, 'jira-card')).toHaveCount(3);
    await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
  });

  test('a term no loaded card matches searches Jira, finds a Done issue, and opens its detail panel', async () => {
    await tid(page, 'board-search-input').fill('legacy runbook');
    const result = page.locator('[data-testid="board-search-result"][data-issue-key="DEMO-109"]');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Done');

    // The search went through the workspace's own projects, Done included.
    const calls = await page.evaluate(() => window.vermilian.debugGetJiraCalls!());
    const search = calls.filter((c) => c.fn === 'searchJql' && (c.jql ?? '').includes('text ~'));
    expect(search.length).toBeGreaterThan(0);
    expect(search[search.length - 1].jql).toBe('project in ("DEMO", "OPS") AND text ~ "legacy runbook" ORDER BY updated DESC');

    await result.click();
    await expect(tid(page, 'jira-detail-issue-key')).toHaveText('DEMO-109');
  });

  test('Enter searches Jira even while loaded cards match, and an exact key is found', async () => {
    await tid(page, 'board-search-input').fill('demo-109');
    await expect(tid(page, 'jira-card')).toHaveCount(0);
    await expect(page.locator('[data-testid="board-search-result"][data-issue-key="DEMO-109"]')).toBeVisible();

    await tid(page, 'board-search-input').fill('rotate');
    await expect.poll(() => visibleCardKeys(page)).toEqual(['DEMO-101']);
    await expect(tid(page, 'board-search-results')).toHaveCount(0);
    await tid(page, 'board-search-input').press('Enter');
    await expect(page.locator('[data-testid="board-search-result"][data-issue-key="DEMO-101"]')).toBeVisible();
  });

  test('"/" focuses the board search, but not while typing elsewhere', async () => {
    await page.locator('body').click();
    await page.keyboard.press('/');
    await expect(tid(page, 'board-search-input')).toBeFocused();
    await expect(tid(page, 'board-search-input')).toHaveValue('');

    // Typing "/" into the top-bar search stays there.
    await tid(page, 'issue-search-input').click();
    await page.keyboard.type('a/b');
    await expect(tid(page, 'issue-search-input')).toHaveValue('a/b');
  });

  test('Assignee pills: Me, a named assignee, Unassigned, and several at once', async () => {
    await expect(assigneePill(page, '__me__')).toHaveText('Me');
    const others = await page
      .locator('[data-testid="ws-filter-pill"][data-section="Assignee"]')
      .evaluateAll((els) => els.map((e) => e.textContent));
    expect(others).toEqual(['Me', 'Unassigned', 'Dana Ops']);

    await assigneePill(page, '__me__').click();
    await expect.poll(() => visibleCardKeys(page)).toEqual(['DEMO-101']);

    await assigneePill(page, '__unassigned__').click();
    await expect.poll(() => visibleCardKeys(page)).toEqual(['DEMO-101', 'OPS-7']);

    await assigneePill(page, '__me__').click();
    await assigneePill(page, '__unassigned__').click();
    await assigneePill(page, 'e2e-account-dana').click();
    await expect.poll(() => visibleCardKeys(page)).toEqual(['DEMO-102']);

    // Combined with the search text: AND.
    await tid(page, 'board-search-input').fill('rotate');
    await expect(tid(page, 'jira-card')).toHaveCount(0);
    await tid(page, 'board-search-input').fill('');

    await page.locator('[data-testid="ws-filter-bar"] >> text=Clear').click();
    await expect(tid(page, 'jira-card')).toHaveCount(3);
  });

  test('the top-bar search follows the Jira workspace, never YouTrack', async () => {
    await tid(page, 'issue-search-input').fill('alert');
    const result = page.locator('[data-testid="issue-search-result"]');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('OPS-7');
    await result.click();
    await expect(tid(page, 'jira-detail-issue-key')).toHaveText('OPS-7');
  });
});

test('a rejected Jira token surfaces as a clear message in the top-bar search', async () => {
  const { app, page } = await openJiraBoard({ VERMILIAN_E2E_JIRA_401: '1' });
  try {
    await tid(page, 'issue-search-input').fill('alert');
    await expect(tid(page, 'issue-search-error')).toBeVisible({ timeout: 15_000 });
    await expect(tid(page, 'issue-search-error')).not.toHaveText(/Check your connection/);
    await expect(tid(page, 'issue-search-result')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test.describe('All tasks board search (YouTrack)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-all-tasks"]', { timeout: 15_000 });
    await page.locator('[data-testid="nav-all-tasks"]').click();
    await page.waitForSelector('[data-testid="ws-issue-row"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('typing filters rows by key or summary; Enter lists backend results that open the detail panel', async () => {
    const rows = page.locator('[data-testid="ws-issue-row"]');
    const total = await rows.count();

    await tid(page, 'board-search-input').fill('test-5');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-issue-id', 'TEST-5');
    await expect(tid(page, 'ws-issue-count')).toContainText(`1 of ${total}`);

    await tid(page, 'board-search-input').press('Enter');
    const result = page.locator('[data-testid="board-search-result"][data-issue-key="TEST-5"]');
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();

    await tid(page, 'board-search-input').fill('');
    await expect(rows).toHaveCount(total);
  });

  test('"/" focuses the board search', async () => {
    await page.locator('body').click();
    await page.keyboard.press('/');
    await expect(tid(page, 'board-search-input')).toBeFocused();
  });
});

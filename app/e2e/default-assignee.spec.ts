/**
 * The Default assignee (VERM-68) on the All tasks board, against the fake
 * YouTrack, whose fixtures assign TEST-1 and TEST-5 to 'e2e-user' and TEST-2
 * to 'alice', and the fake Jira, which assigns DEMO-101 to 'e2e-account'.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

function seedConfig(userData: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(userData, 'app-config.json'),
    JSON.stringify({ youtrackUrl: 'http://e2e.local', youtrackLogin: 'e2e-user', ...extra }),
  );
}

async function rowIds(page: Page): Promise<string[]> {
  const ids = await tid(page, 'ws-issue-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-issue-id') ?? ''));
  return ids.sort();
}

async function openAllTasks(page: Page) {
  await page.waitForSelector('[data-testid="nav-all-tasks"]', { timeout: 15_000 });
  await tid(page, 'nav-all-tasks').click();
  await page.waitForSelector('[data-testid="ws-issue-row"]', { timeout: 15_000 });
}

async function setDefaultAssignee(page: Page, fill: (page: Page) => Promise<void>) {
  await tid(page, 'topbar-settings-btn').click();
  await expect(tid(page, 'default-assignee-section')).toBeVisible();
  await fill(page);
  await tid(page, 'settings-save-btn').click();
  await expect(tid(page, 'default-assignee-section')).toHaveCount(0, { timeout: 15_000 });
}

test.describe('Default assignee — YouTrack All tasks', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeEach(async () => {
    userData = freshUserDataDir();
    seedConfig(userData);
    app = await launchAppWithUserDataDir(userData);
    page = await app.firstWindow();
    await openAllTasks(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('with the field empty the board is unchanged', async () => {
    await expect(tid(page, 'default-assignee-bar')).toHaveCount(0);
    expect((await rowIds(page)).length).toBeGreaterThan(2);
  });

  test('opens on my issues, toggles to everyone, and returns after a relaunch', async () => {
    const everyone = await rowIds(page);
    await setDefaultAssignee(page, (p) => tid(p, 'default-assignee-use-mine').click());
    await openAllTasks(page);

    await expect.poll(() => rowIds(page)).toEqual(['TEST-1', 'TEST-5']);
    await expect(tid(page, 'default-assignee-note')).toHaveText('Showing only your issues.');
    await expect(page.locator('[data-testid="ws-filter-pill"][data-section="Assignee"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="ws-filter-pill"][data-section="Assignee"]')).toHaveText('Me');

    await tid(page, 'default-assignee-toggle').click();
    await expect.poll(() => rowIds(page)).toEqual(everyone);
    await expect(page.locator('[data-testid="ws-filter-pill"][data-section="Assignee"][data-value="alice"]')).toBeVisible();

    await app.close();
    app = await launchAppWithUserDataDir(userData);
    page = await app.firstWindow();
    await openAllTasks(page);
    await expect.poll(() => rowIds(page)).toEqual(['TEST-1', 'TEST-5']);
  });

  test('search still finds an issue assigned to someone else', async () => {
    await setDefaultAssignee(page, (p) => tid(p, 'default-assignee-use-mine').click());
    await openAllTasks(page);
    await expect.poll(() => rowIds(page)).toEqual(['TEST-1', 'TEST-5']);

    await tid(page, 'board-search-input').fill('TEST-2');
    await expect(tid(page, 'board-search-result').filter({ hasText: 'TEST-2' })).toBeVisible({ timeout: 10_000 });
  });

  test('an identity no issue carries shows everyone and says so', async () => {
    const everyone = await rowIds(page);
    await setDefaultAssignee(page, (p) => tid(p, 'default-assignee-field').locator('input').fill('nobody-here'));
    await openAllTasks(page);
    await expect(tid(page, 'default-assignee-unmatched')).toBeVisible();
    await expect.poll(() => rowIds(page)).toEqual(everyone);
  });

  test('clearing the field restores the full board', async () => {
    const everyone = await rowIds(page);
    await setDefaultAssignee(page, (p) => tid(p, 'default-assignee-use-mine').click());
    await openAllTasks(page);
    await expect.poll(() => rowIds(page)).toEqual(['TEST-1', 'TEST-5']);

    await setDefaultAssignee(page, (p) => tid(p, 'default-assignee-clear').click());
    await openAllTasks(page);
    await expect(tid(page, 'default-assignee-bar')).toHaveCount(0);
    await expect.poll(() => rowIds(page)).toEqual(everyone);
  });
});

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
  workspaceId: 'ws-e2eja1',
  name: 'Jira mine',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
};

test('a Jira board opens on my issues, and switching workspace returns to them', async () => {
  const userData = freshUserDataDir();
  seedConfig(userData, { defaultAssignees: { 'ws-e2eja1': 'e2e-account' } });
  const app = await launchAppWithUserDataDir(userData, { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const doc of [YT, JIRA]) {
      const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    const choose = async (name: string) => {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    };
    await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
    await choose('Jira mine');

    const cards = tid(page, 'jira-card');
    await expect(cards).toHaveCount(1, { timeout: 15_000 });
    await expect(cards).toHaveAttribute('data-issue-key', 'DEMO-101');
    await expect(tid(page, 'jira-issue-count')).toHaveText('1 of 3 issues');

    await tid(page, 'default-assignee-toggle').click();
    await expect(cards).toHaveCount(3);

    await choose('Workspace A');
    await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A');
    await choose('Jira mine');
    await expect(cards).toHaveCount(1, { timeout: 15_000 });

    const fns = (await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).map((c) => c.fn);
    expect(fns.filter((f) => /^(create|update|edit|delete|transition|assign|add)/i.test(f))).toEqual([]);
  } finally {
    await app.close();
  }
});

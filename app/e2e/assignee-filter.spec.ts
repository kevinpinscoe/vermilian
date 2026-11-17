/**
 * Assignee filter (VERM-62) on the All tasks workspace board and on a project
 * board. Runs against the in-memory fake YouTrack (VERMILIAN_E2E=1), whose
 * fixtures assign TEST-1 and TEST-5 to 'e2e-user', TEST-2 to 'alice' and
 * TST2-2 to 'bob'; every other issue is unassigned. The profile is seeded with
 * youtrackLogin 'e2e-user', so the "Me" pill means TEST-1 and TEST-5.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

async function launchAsE2eUser(): Promise<ElectronApplication> {
  const userData = freshUserDataDir();
  fs.writeFileSync(
    path.join(userData, 'app-config.json'),
    JSON.stringify({ youtrackUrl: 'http://e2e.local', youtrackLogin: 'e2e-user' }),
  );
  return launchAppWithUserDataDir(userData);
}

function wsPill(page: Page, value: string) {
  return page.locator(`[data-testid="ws-filter-pill"][data-section="Assignee"][data-value="${value}"]`);
}

async function visibleIds(page: Page, rowTestId: string, idAttr: string): Promise<string[]> {
  const ids = await page.locator(`[data-testid="${rowTestId}"]`).evaluateAll(
    (rows, attr) => rows.map((r) => r.getAttribute(attr) ?? ''),
    idAttr,
  );
  return ids.sort();
}

test.describe('Assignee filter — All tasks', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAsE2eUser();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-all-tasks"]', { timeout: 15_000 });
    await page.locator('[data-testid="nav-all-tasks"]').click();
    await page.waitForSelector('[data-testid="ws-issue-row"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('offers Me, Unassigned and the other assignees, without the current user by login', async () => {
    const values = await page
      .locator('[data-testid="ws-filter-pill"][data-section="Assignee"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
    expect(values).toEqual(['__me__', '__unassigned__', 'alice', 'bob']);
    await expect(wsPill(page, '__me__')).toHaveText('Me');
    await expect(wsPill(page, '__unassigned__')).toHaveText('Unassigned');
  });

  test('pill toggling narrows the board, combines with OR, and Clear restores it', async () => {
    const rows = page.locator('[data-testid="ws-issue-row"]');
    const total = await rows.count();

    await wsPill(page, '__me__').click();
    await expect.poll(() => visibleIds(page, 'ws-issue-row', 'data-issue-id')).toEqual(['TEST-1', 'TEST-5']);

    await wsPill(page, 'alice').click();
    await expect.poll(() => visibleIds(page, 'ws-issue-row', 'data-issue-id')).toEqual(['TEST-1', 'TEST-2', 'TEST-5']);

    // Toggling Me off leaves only alice.
    await wsPill(page, '__me__').click();
    await expect.poll(() => visibleIds(page, 'ws-issue-row', 'data-issue-id')).toEqual(['TEST-2']);

    await page.locator('[data-testid="ws-filter-bar"] >> text=Clear').click();
    await expect(rows).toHaveCount(total);
  });

  test('Unassigned shows only issues with no assignee', async () => {
    await wsPill(page, '__unassigned__').click();
    const ids = await visibleIds(page, 'ws-issue-row', 'data-issue-id');
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ['TEST-1', 'TEST-2', 'TEST-5', 'TST2-2']) expect(ids).not.toContain(id);
  });

  test('the Assigned to me button and the Me pill are the same filter', async () => {
    await page.locator('button', { hasText: 'Assigned to me' }).click();
    await expect.poll(() => visibleIds(page, 'ws-issue-row', 'data-issue-id')).toEqual(['TEST-1', 'TEST-5']);
    await expect(wsPill(page, '__me__')).toHaveClass(/filterPillActive/);
  });
});

test.describe('Assignee filter — project board', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAsE2eUser();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await page.locator('[data-testid="nav-project"]').first().click();
    await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('Me, a named assignee and Unassigned each filter the TEST board', async () => {
    const rows = page.locator('[data-testid="task-row"]');
    await expect(rows).toHaveCount(6);
    await page.locator('[data-testid="filter-btn"]').click();

    await page.locator('[data-testid="filter-pill"][data-value="__me__"]').click();
    await expect.poll(() => visibleIds(page, 'task-row', 'data-task-id')).toEqual(['0-e1-1', '0-e1-5']);

    await page.locator('[data-testid="filter-pill"][data-value="__me__"]').click();
    await page.locator('[data-testid="filter-pill"][data-value="alice"]').click();
    await expect.poll(() => visibleIds(page, 'task-row', 'data-task-id')).toEqual(['0-e1-2']);

    await page.locator('[data-testid="filter-pill"][data-value="alice"]').click();
    await page.locator('[data-testid="filter-pill"][data-value="__unassigned__"]').click();
    await expect.poll(() => visibleIds(page, 'task-row', 'data-task-id')).toEqual(['0-e1-3', '0-e1-4', '0-e1-6']);

    await page.locator('[data-testid="filter-bar"] >> text=Clear all').click();
    await expect(rows).toHaveCount(6);
  });
});

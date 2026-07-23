/**
 * Top-bar issue search. Covers the TODO "Issue search" acceptance criteria plus
 * the v1.2.1 workspace-scope fix: search stays usable on the All-tasks view
 * (never shows the disabled/blocked state) and searches every project in the
 * active workspace when no single project is selected.
 *
 * Fake YouTrack: TEST issues 0-e1-1..6 (TEST-5/6 are "In Progress task N"),
 * TST2-1/INB-1 are "To do task 1" — so "To do task 1" spans three projects.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Issue search — active project scope', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('typing finds matching issues in the active project', async () => {
    await page.locator('[data-testid="issue-search-input"]').fill('In Progress');
    const results = page.locator('[data-testid="issue-search-result"]');
    await expect(results.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="issue-search-results"]')).toContainText('TEST-5');
  });

  test('selecting a result opens the task detail panel', async () => {
    await page.locator('[data-testid="issue-search-input"]').fill('In Progress task 5');
    const result = page.locator('[data-testid="issue-search-result"]').first();
    await expect(result).toBeVisible({ timeout: 10_000 });
    await result.click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-5');
  });

  test('a query with no matches shows the empty state', async () => {
    await page.locator('[data-testid="issue-search-input"]').fill('zzz-nonexistent-xyz');
    await expect(page.locator('[data-testid="issue-search-empty"]')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Issue search — workspace scope (no project selected)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    // The app launches on the All-tasks workspace board. Wait for config to load.
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('search box is usable on the All-tasks view (never blocked)', async () => {
    await expect(page.locator('[data-testid="issue-search-input"]')).toBeEnabled({ timeout: 15_000 });
  });

  test('finds issues across multiple projects in the workspace', async () => {
    await expect(page.locator('[data-testid="issue-search-input"]')).toBeEnabled({ timeout: 15_000 });
    await page.locator('[data-testid="issue-search-input"]').fill('To do task 1');
    const results = page.locator('[data-testid="issue-search-results"]');
    await expect(results).toContainText('TEST-1', { timeout: 10_000 });
    await expect(results).toContainText('TST2-1');
  });
});

/**
 * Top-bar issue search, scoped to the active project. Covers the TODO "Issue
 * search" acceptance criteria: type in the top search bar to find issues,
 * selecting a result opens the matching issue, and empty/no-result states are
 * handled. Fake YouTrack: TEST project issues 0-e1-1..6; TEST-5/6 are
 * "In Progress task N".
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Issue search', () => {
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

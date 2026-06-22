/**
 * Board Filter / Sort toolbar (commit fae88aa). Runs against the in-memory fake
 * YouTrack (VERMILIAN_E2E=1): project TEST has 4 issues in "To do" and 2 in
 * "In Progress" (summaries "To do task N" / "In Progress task N").
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Board filter', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('Filter button toggles the filter bar', async () => {
    await expect(page.locator('[data-testid="filter-bar"]')).toBeHidden();
    await page.locator('[data-testid="filter-btn"]').click();
    await expect(page.locator('[data-testid="filter-bar"]')).toBeVisible();
    await page.locator('[data-testid="filter-btn"]').click();
    await expect(page.locator('[data-testid="filter-bar"]')).toBeHidden();
  });

  test('text search narrows the visible rows', async () => {
    const rows = page.locator('[data-testid="task-row"]');
    await expect(rows).toHaveCount(6);
    await page.locator('[data-testid="filter-btn"]').click();
    await page.locator('[data-testid="filter-search"]').fill('task 1');
    // "task 1" matches only "To do task 1"
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-task-id', '0-e1-1');
  });

  test('status pill filters to a single group, Clear all resets', async () => {
    const rows = page.locator('[data-testid="task-row"]');
    await page.locator('[data-testid="filter-btn"]').click();
    await page.locator('[data-testid="filter-pill"][data-value="In Progress"]').click();
    await expect(rows).toHaveCount(2); // only the two In Progress issues
    await page.locator('[data-testid="filter-bar"] >> text=Clear all').click();
    await expect(rows).toHaveCount(6);
  });

  test('no-match search shows the empty state', async () => {
    await page.locator('[data-testid="filter-btn"]').click();
    await page.locator('[data-testid="filter-search"]').fill('zzz-no-such-task');
    await expect(page.locator('[data-testid="filtered-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-row"]')).toHaveCount(0);
    // Clear from the empty-state action restores the rows.
    await page.locator('[data-testid="filtered-empty"] >> text=Clear all filters').click();
    await expect(page.locator('[data-testid="task-row"]')).toHaveCount(6);
  });
});

test.describe('Board sort', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('Sort menu opens and sorting by summary reorders within a group', async () => {
    await page.locator('[data-testid="sort-btn"]').click();
    await expect(page.locator('[data-testid="sort-menu"]')).toBeVisible();

    // Sort by summary descending → "To do task 4" sorts to the top of its group.
    await page.locator('[data-testid="sort-dir"][data-col="summary"][data-dir="desc"]').click();
    const firstRow = page.locator('[data-testid="task-row"]').first();
    await expect(firstRow).toHaveAttribute('data-task-id', '0-e1-4');

    // Ascending flips it back.
    await page.locator('[data-testid="sort-btn"]').click();
    await page.locator('[data-testid="sort-dir"][data-col="summary"][data-dir="asc"]').click();
    await expect(firstRow).toHaveAttribute('data-task-id', '0-e1-1');
  });
});

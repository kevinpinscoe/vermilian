/**
 * Board toolbar presence and group collapse/expand (project-board.md
 * "Toolbar" + "Main table view" group rows).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Board toolbar and groups', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('the toolbar exposes the core controls', async () => {
    await expect(page.locator('[data-testid="new-task-btn"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI create' })).toBeVisible();
    await expect(page.locator('[data-testid="filter-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="sort-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="hide-columns-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="group-by-select"]')).toBeVisible();
  });

  test('clicking a group header collapses and re-expands its rows', async () => {
    const todo = page.locator('[data-testid="task-group"][data-group-val="To do"]');
    const rows = todo.locator('[data-testid="task-row"]');
    const toggle = todo.locator('[data-testid="group-header"] button');

    await expect(rows).toHaveCount(4);

    await toggle.click();
    await expect(rows).toHaveCount(0); // collapsed → rows unmount

    await toggle.click();
    await expect(rows).toHaveCount(4); // expanded again
  });
});

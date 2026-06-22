/**
 * Workspace folder management (workspace-navigation.md "Folder management") and
 * the collapsible rail. Fresh install: one "Unassigned" folder holding both
 * fake projects; new folders are created empty so Delete is enabled.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function addFolder(page: Page, name: string) {
  await page.locator('[data-testid="add-folder-btn"]').click();
  await page.locator('[data-testid="add-folder-input"]').fill(name);
  await page.locator('[data-testid="add-folder-input"]').press('Enter');
  await expect(page.locator('nav').getByText(name, { exact: true })).toBeVisible();
}

test.describe('Workspace folders and rail', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('rename a folder via its context menu', async () => {
    await addFolder(page, 'Backlog');

    await page.locator('nav').getByText('Backlog', { exact: true }).click({ button: 'right' });
    await page.locator('[data-testid="folder-menu-rename"]').click();

    const input = page.locator('[data-testid="folder-rename-input"]');
    await input.fill('Renamed');
    await input.press('Enter');

    await expect(page.locator('nav').getByText('Renamed', { exact: true })).toBeVisible();
    await expect(page.locator('nav').getByText('Backlog', { exact: true })).toHaveCount(0);
  });

  test('delete an empty folder via its context menu', async () => {
    await addFolder(page, 'Temp');

    await page.locator('nav').getByText('Temp', { exact: true }).click({ button: 'right' });
    await page.locator('[data-testid="folder-menu-delete"]').click();

    await expect(page.locator('nav').getByText('Temp', { exact: true })).toHaveCount(0);
  });

  test('the hamburger collapses and re-expands the rail', async () => {
    await expect(page.getByLabel('Collapse navigation')).toBeVisible();

    await page.getByLabel('Collapse navigation').click();
    await expect(page.getByLabel('Expand navigation')).toBeVisible();

    await page.getByLabel('Expand navigation').click();
    await expect(page.getByLabel('Collapse navigation')).toBeVisible();
  });
});

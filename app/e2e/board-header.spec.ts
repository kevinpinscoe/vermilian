/**
 * Board header (project-board.md "Board entry" + "Inbox indicator"): the header
 * shows the project name, and an Inbox-named project shows the Inbox indicator.
 * Fake YouTrack: "Test Project" (TEST) and "Team Inbox" (INB, name contains
 * "Inbox").
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function openProject(page: Page, name: string) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').filter({ hasText: name }).first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Board header', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
  });
  test.afterEach(async () => { await app.close(); });

  test('shows the selected project name', async () => {
    await openProject(page, 'Test Project');
    await expect(page.locator('[data-testid="board-title"]')).toHaveText('Test Project');
    await expect(page.locator('[data-testid="board-inbox-badge"]')).toHaveCount(0);
  });

  test('an Inbox project shows the Inbox indicator', async () => {
    await openProject(page, 'Team Inbox');
    await expect(page.locator('[data-testid="board-title"]')).toHaveText('Team Inbox');
    await expect(page.locator('[data-testid="board-inbox-badge"]')).toBeVisible();
  });
});

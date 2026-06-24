/**
 * Board empty states.
 * Fake YouTrack: "Empty Project" (EMP, 0-e4) deliberately has zero issues, while
 * "Test Project" (TEST) has several. Opening EMP must show the "No tasks in this
 * project yet" empty state; opening TEST must render the table instead.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function openProject(page: Page, name: string) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').filter({ hasText: name }).first().click();
}

test.describe('Board empty states', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
  });
  test.afterEach(async () => { await app.close(); });

  test('a project with no tasks shows the empty state', async () => {
    await openProject(page, 'Empty Project');
    await expect(page.locator('[data-testid="project-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-empty"]')).toContainText('No tasks in this project yet');
    // The table should not render when the project is empty.
    await expect(page.locator('[data-testid="main-table"]')).toHaveCount(0);
  });

  test('a project with tasks does not show the empty state', async () => {
    await openProject(page, 'Test Project');
    await expect(page.locator('[data-testid="project-empty"]')).toHaveCount(0);
  });
});

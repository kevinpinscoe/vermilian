/**
 * Inline chip-cell editing on the main table (project-board.md "Inline editing").
 * Clicking a Status/Priority/Category chip opens a dropdown; selecting a value
 * PATCHes the issue. Fake YouTrack: TEST issue 0-e1-1 = "To do" / "Normal".
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Inline chip-cell edit', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('editing a non-grouping chip updates the cell in place', async () => {
    const chip = page.locator('[data-task-id="0-e1-1"] [data-testid="chip-cell"][data-field="priority"]');
    await expect(chip).toHaveText('Normal');

    await chip.click();
    await expect(page.locator('[data-testid="chip-dropdown"]')).toBeVisible();
    await page.locator('[data-testid="chip-option"][data-value="Critical"]').click();

    await expect(chip).toHaveText('Critical');
  });

  test('editing the Status chip moves the row to the new group', async () => {
    const todo = page.locator('[data-testid="task-group"][data-group-val="To do"]');
    const inProgress = page.locator('[data-testid="task-group"][data-group-val="In Progress"]');
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(4);
    await expect(inProgress.locator('[data-testid="task-row"]')).toHaveCount(2);

    await page.locator('[data-task-id="0-e1-1"] [data-testid="chip-cell"][data-field="status"]').click();
    await expect(page.locator('[data-testid="chip-dropdown"]')).toBeVisible();
    await page.locator('[data-testid="chip-option"][data-value="In Progress"]').click();

    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(3);
    await expect(inProgress.locator('[data-task-id="0-e1-1"]')).toBeVisible();
  });
});

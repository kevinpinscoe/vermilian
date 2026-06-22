/**
 * Inline quick-add (`+ Add task`) on the main table. Covers project-board.md
 * "Inline + Add task (quick-add)" criteria reachable in the fake harness:
 * Enter creates in the current group, Esc cancels.
 * Fake YouTrack: TEST project "To do" group starts with 4 issues (0-e1-1..4).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

const TODO_GROUP = '[data-testid="task-group"][data-group-val="To do"]';

test.describe('Quick-add task', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('Enter creates a task in the current group', async () => {
    const group = page.locator(TODO_GROUP);
    const rows = group.locator('[data-testid="task-row"]');
    await expect(rows).toHaveCount(4);

    await group.locator('[data-testid="add-task-btn"]').click();
    const input = group.locator('[data-testid="add-task-input"]');
    await input.fill('Quick-added via e2e');
    await input.press('Enter');

    // New task lands in the "To do" group and shows the typed summary.
    await expect(rows).toHaveCount(5);
    await expect(group.getByText('Quick-added via e2e')).toBeVisible();
  });

  test('Esc cancels without creating a task', async () => {
    const group = page.locator(TODO_GROUP);
    const rows = group.locator('[data-testid="task-row"]');
    await expect(rows).toHaveCount(4);

    await group.locator('[data-testid="add-task-btn"]').click();
    const input = group.locator('[data-testid="add-task-input"]');
    await input.fill('Should not be created');
    await input.press('Escape');

    await expect(input).toBeHidden();
    await expect(rows).toHaveCount(4);
    await expect(group.getByText('Should not be created')).toHaveCount(0);
  });
});

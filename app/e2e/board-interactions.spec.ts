/**
 * Board interactions: group-by, inline summary edit, and the detail panel.
 * Fake YouTrack: TEST project issues 0-e1-1..4 ("To do", priorities
 * Normal/Critical/Minor/Major) and 0-e1-5..6 ("In Progress", Normal/Critical).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Board interactions', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('group-by selector regroups the board', async () => {
    const headers = page.locator('[data-testid="group-header"]');
    // Default groups by Status: "To do" + "In Progress".
    await expect(headers).toHaveCount(2);

    await page.locator('[data-testid="group-by-select"]').selectOption({ value: 'Priority' });

    // Priority groups: Critical, Major, Normal, Minor all present.
    await expect(headers).toHaveCount(4);
    await expect(headers.filter({ hasText: 'Critical' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Major' })).toBeVisible();
  });

  test('inline summary edit persists', async () => {
    const row = page.locator('[data-task-id="0-e1-1"]');
    await row.locator('[data-testid="summary-cell"]').click();
    const input = page.locator('[data-testid="summary-input"]');
    await input.fill('Renamed in e2e');
    await input.press('Enter');

    await expect(row.locator('[data-testid="summary-cell"]')).toHaveText('Renamed in e2e');
  });

  test('inline Due Date cell sets a date on an undated task', async () => {
    // TEST-3 (0-e1-3) starts undated → the cell shows the em-dash placeholder.
    const cell = page.locator('[data-task-id="0-e1-3"] [data-testid="due-date-cell"]');
    await expect(cell).toHaveText('—');

    await cell.click();
    await page.locator('[data-task-id="0-e1-3"] [data-testid="due-date-input"]').fill('2026-07-15');

    // onChange saves and closes the editor; the cell now shows a formatted date.
    await expect(page.locator('[data-task-id="0-e1-3"] [data-testid="due-date-cell"]')).not.toHaveText('—');
  });

  test('clicking a row opens the detail panel', async () => {
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeHidden();
    await page.locator('[data-task-id="0-e1-1"] [data-testid="issue-id"]').click();
    const panel = page.locator('[data-testid="task-detail-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('To do task 1');
  });

  test('switching to the Kanban view tab renders the kanban board', async () => {
    await expect(page.locator('[data-testid="main-table"]')).toBeVisible();
    await page.locator('[data-testid="view-tab"][data-view-type="kanban"]').click();
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="main-table"]')).toBeHidden();
  });
});

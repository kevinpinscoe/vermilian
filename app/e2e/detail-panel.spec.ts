/**
 * Task-detail panel: header identity, close (× / Escape), task switching, and
 * delete-with-confirmation. Covers task-detail.md acceptance criteria.
 * Fake YouTrack: TEST project (Test Project) issues 0-e1-1..4 ("To do").
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

async function openDetail(page: Page, taskId: string) {
  await page.locator(`[data-task-id="${taskId}"] [data-testid="issue-id"]`).click();
  await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
}

test.describe('Task detail panel', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('header shows the issue id and project name', async () => {
    await openDetail(page, '0-e1-1');
    await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-1');
    await expect(page.locator('[data-testid="detail-project"]')).toHaveText('Test Project');
  });

  test('the close button dismisses the panel', async () => {
    await openDetail(page, '0-e1-1');
    await page.getByLabel('Close panel').click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeHidden();
  });

  test('Escape dismisses the panel', async () => {
    await openDetail(page, '0-e1-1');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeHidden();
  });

  test('clicking another row swaps the loaded task without closing', async () => {
    await openDetail(page, '0-e1-1');
    await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-1');

    await page.locator('[data-task-id="0-e1-2"] [data-testid="issue-id"]').click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-2');
  });

  test('Delete asks for confirmation; Cancel keeps the task', async () => {
    await openDetail(page, '0-e1-1');
    await page.getByLabel('Delete task').click();
    await expect(page.locator('[data-testid="delete-confirm"]')).toBeVisible();

    await page.locator('[data-testid="delete-confirm"]').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-testid="delete-confirm"]')).toBeHidden();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-task-id="0-e1-1"]')).toBeVisible();
  });

  test('confirming Delete removes the task and closes the panel', async () => {
    await openDetail(page, '0-e1-1');
    await page.getByLabel('Delete task').click();
    await page.locator('[data-testid="delete-confirm-btn"]').click();

    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeHidden();
    await expect(page.locator('[data-task-id="0-e1-1"]')).toHaveCount(0);
  });
});

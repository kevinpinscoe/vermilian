/**
 * Inline field editing inside the task-detail panel (task-detail.md "Field
 * display and inline editing"): click a value to edit, Enter/blur saves, Esc
 * reverts. Fake YouTrack: TEST issue 0-e1-1 has ticket "JIRA-1".
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

test.describe('Task detail inline field edit', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
    await openDetail(page, '0-e1-1');
  });
  test.afterEach(async () => { await app.close(); });

  test('editing a text field commits on Enter', async () => {
    const ticket = page.locator('[data-field="ticket"]');
    await expect(ticket.locator('button')).toHaveText('JIRA-1');

    await ticket.locator('button').click();
    const input = ticket.locator('input');
    await input.fill('JIRA-999');
    await input.press('Enter');

    await expect(ticket.locator('button')).toHaveText('JIRA-999');
  });

  test('Escape reverts an in-progress edit without saving', async () => {
    await page.locator('[data-field="ticket"] button').click();
    const input = page.locator('[data-field="ticket"] input');
    await input.fill('should not persist');
    await input.press('Escape');

    // Escape reverts the field; it also closes the panel (panel-level Escape
    // handler, task-detail.md criterion 13). Reopen to confirm nothing saved.
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeHidden();
    await openDetail(page, '0-e1-1');
    await expect(page.locator('[data-field="ticket"] button')).toHaveText('JIRA-1');
  });
});

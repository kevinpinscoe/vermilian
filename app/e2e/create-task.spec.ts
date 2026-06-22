/**
 * Create-task modal (create-task.md): open from the toolbar New task button,
 * Summary-required validation, happy-path create, Escape dismiss.
 * Fake YouTrack: createIssue defaults status "To do" → new task joins that group.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

const SUMMARY = '#ct-summary';
const CREATE = '[data-testid="task-create-btn"]';

test.describe('Create-task modal', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('New task button opens the modal', async () => {
    await expect(page.locator(SUMMARY)).toBeHidden();
    await page.locator('[data-testid="new-task-btn"]').click();
    await expect(page.locator(SUMMARY)).toBeVisible();
  });

  test('Create is disabled until Summary is entered', async () => {
    await page.locator('[data-testid="new-task-btn"]').click();
    await expect(page.locator(CREATE)).toBeDisabled();
    await page.locator(SUMMARY).fill('A real task');
    await expect(page.locator(CREATE)).toBeEnabled();
  });

  test('creating a task adds it to the To do group and closes the modal', async () => {
    const todo = page.locator('[data-testid="task-group"][data-group-val="To do"]');
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(4);

    await page.locator('[data-testid="new-task-btn"]').click();
    await page.locator(SUMMARY).fill('Created via the modal');
    await page.locator(CREATE).click();

    await expect(page.locator(SUMMARY)).toBeHidden();
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(5);
    await expect(todo.getByText('Created via the modal')).toBeVisible();
  });

  test('Escape dismisses the modal without creating', async () => {
    const todo = page.locator('[data-testid="task-group"][data-group-val="To do"]');
    await page.locator('[data-testid="new-task-btn"]').click();
    await page.locator(SUMMARY).fill('Should not be created');
    await page.keyboard.press('Escape');

    await expect(page.locator(SUMMARY)).toBeHidden();
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(4);
  });
});

/**
 * AI create task (create-task-ai.md). Runs against the in-memory fake YouTrack
 * AND the in-memory fake Claude (VERMILIAN_E2E=1): extractTaskFields returns
 * deterministic, description-driven fields, so the input → review → create flow
 * works with no API key or network. createIssue defaults status "To do".
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

const SUMMARY = '#ct-summary';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('AI create task', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('describe → generate → review → create adds the task', async () => {
    const todo = page.locator('[data-testid="task-group"][data-group-val="To do"]');
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(4);

    await page.locator('[data-testid="ai-create-btn"]').click();
    await page.locator('#ai-description').fill('Fix the login crash on Safari — critical, JIRA-456');
    await page.locator('[data-testid="ai-generate-btn"]').click();

    // Review step: the summary is the description's first line (fake extraction).
    await expect(page.locator(SUMMARY)).toBeVisible();
    await expect(page.locator(SUMMARY)).toHaveValue('Fix the login crash on Safari — critical, JIRA-456');

    await page.locator('[data-testid="ai-create-submit"]').click();

    // Modal closes and the new task lands in the To do group.
    await expect(page.locator(SUMMARY)).toBeHidden();
    await expect(todo.locator('[data-testid="task-row"]')).toHaveCount(5);
    await expect(todo.getByText('Fix the login crash on Safari — critical, JIRA-456')).toBeVisible();
  });

  test('a too-vague description asks for clarification instead of a review step', async () => {
    await page.locator('[data-testid="ai-create-btn"]').click();
    await page.locator('#ai-description').fill('ab');
    await page.locator('[data-testid="ai-generate-btn"]').click();

    // Stays on the input step (no summary field) and shows the clarification banner.
    await expect(page.locator(SUMMARY)).toBeHidden();
    await expect(page.getByText(/describe the task in a bit more detail/i)).toBeVisible();
  });
});

/**
 * Daily stand-up (standup-report.md). Runs against the in-memory fake YouTrack
 * AND the in-memory fake Claude (VERMILIAN_E2E=1): getIssuesForStandup returns
 * deterministic Done/In Progress/Blocked tasks and generateStandupReport turns
 * them into markdown, so the config → generate → report flow needs no API key.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

test.describe('Daily stand-up', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="standup-btn"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('generate produces a report from the stand-up tasks', async () => {
    await page.locator('[data-testid="standup-btn"]').click();
    await expect(page.locator('#standup-modal')).toBeVisible();

    await page.locator('[data-testid="standup-generate-btn"]').click();

    const body = page.locator('[data-testid="standup-report-body"]');
    await expect(body).toBeVisible();
    // Sections and bullets built from the fake stand-up fixtures.
    await expect(body.locator('h2')).toContainText(['Done', 'In Progress', 'Blocked']);
    await expect(body).toContainText('TEST-1');
    await expect(body).toContainText('Finished the login flow');
    await expect(body).toContainText('Waiting on a vendor response');
  });
});

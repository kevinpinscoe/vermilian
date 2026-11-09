/**
 * Jira section in Settings (VERM-20): fill the profile, press Test connection
 * and see the probe result, save it to the (fake) YouTrack Jira Article, and
 * find it there when Settings is reopened. Runs against the in-memory fake
 * Jira (src/main/api/fakeJira.ts), which accepts any token as classic except
 * FAKE_JIRA_BAD_TOKEN.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchApp, launchAppWithEnv } from './helpers/launch';

const CLOUD_ID = 'e2e00000-0000-4000-8000-000000000000'; // FAKE_JIRA_CLOUD_ID
const BAD_TOKEN = 'e2e-bad-jira-token'; // FAKE_JIRA_BAD_TOKEN

// Vibe's TextField may put the test id on the <input> or on its wrapper.
function field(page: Page, id: string) {
  return page.locator(`input[data-testid="${id}"], [data-testid="${id}"] input`).first();
}

async function openSettings(page: Page) {
  await page.locator('[data-testid="topbar-settings-btn"]').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jira' })).toBeVisible();
}

test.describe('Jira settings', () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => { await app.close(); });

  test('Test connection shows the probe result, and Save stores the profile', async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openSettings(page);

    await field(page, 'jira-site-url').fill('https://example.atlassian.net/');
    await field(page, 'jira-email').fill('me@example.com');
    await page.locator('[data-testid="jira-test-btn"]').click();

    const result = page.locator('[data-testid="jira-test-result"]');
    await expect(result).toContainText('Connected — logged in as E2E Jira User');
    await expect(result).toContainText('classic API token');
    // The detected cloudId is filled in for the user.
    await expect(field(page, 'jira-cloud-id')).toHaveValue(CLOUD_ID);

    await page.locator('[data-testid="settings-save-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();

    // Reopen: the profile comes back from the Jira Article, normalised.
    await openSettings(page);
    await expect(field(page, 'jira-site-url')).toHaveValue('https://example.atlassian.net');
    await expect(field(page, 'jira-email')).toHaveValue('me@example.com');
    await expect(field(page, 'jira-cloud-id')).toHaveValue(CLOUD_ID);
  });

  test('a rejected token shows the failure', async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openSettings(page);

    await field(page, 'jira-site-url').fill('https://example.atlassian.net');
    await field(page, 'jira-email').fill('me@example.com');
    await field(page, 'jira-token').fill(BAD_TOKEN);
    await page.locator('[data-testid="jira-test-btn"]').click();

    const result = page.locator('[data-testid="jira-test-result"]');
    await expect(result).toContainText('Jira connection failed');
    await expect(result).toContainText('rejected the token');
    await expect(result).not.toContainText(BAD_TOKEN);
  });

  test('an invalid profile is not saved, and Settings stays open', async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openSettings(page);

    await field(page, 'jira-site-url').fill('http://not-https.example.com');
    await field(page, 'jira-email').fill('me@example.com');
    await page.locator('[data-testid="settings-save-btn"]').click();

    await expect(page.locator('[data-testid="jira-save-error"]')).toContainText('https site URL');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('a profile already in YouTrack is shown', async () => {
    app = await launchAppWithEnv({
      VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: JSON.stringify({
        version: 1,
        profile: { siteUrl: 'https://seeded.atlassian.net', email: 'seed@example.com', cloudId: 'seeded-cloud' },
      }),
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openSettings(page);

    await expect(field(page, 'jira-site-url')).toHaveValue('https://seeded.atlassian.net');
    await expect(field(page, 'jira-email')).toHaveValue('seed@example.com');
    await expect(field(page, 'jira-cloud-id')).toHaveValue('seeded-cloud');
  });
});

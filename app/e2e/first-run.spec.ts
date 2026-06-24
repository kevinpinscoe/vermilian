/**
 * First-run flow: app starts unconfigured (no youtrackUrl saved), shows the
 * Settings screen automatically, and navigates to the board after Save.
 *
 * Regression guard for the query-key mismatch bug where App.tsx used
 * ['appConfig'] / ['credentialStatus'] while SettingsView invalidated
 * ['config'] / ['cred-status'], so the connected flag never refetched after
 * save and the settings screen remained stuck open.
 */

import { test, expect, Page } from '@playwright/test';
import { launchAppUnconfigured } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

test.describe('First-run setup flow', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppUnconfigured();
    page = await app.firstWindow();
  });
  test.afterEach(async () => { await app.close(); });

  test('settings screen appears automatically when app is unconfigured', async () => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Connect your YouTrack instance to get started')).toBeVisible();
  });

  test('no Cancel button on first-run settings screen', async () => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden();
  });

  test('Save with a URL navigates to the main board', async () => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder('https://youtrack.example.com').fill('http://e2e.local');
    await page.locator('[data-testid="settings-save-btn"]').click();

    // Settings screen must disappear and the board must appear.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('[data-testid="nav-project"]').first()).toBeVisible({ timeout: 10_000 });
  });
});

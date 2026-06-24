/**
 * Settings view (settings.md): opening from the rail gear, the section layout
 * with Save/Cancel, returning to the board on Cancel, and the discard-unsaved-
 * credentials guard. Runs connected (the E2E harness injects a valid config).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

const SETTINGS_HEADING = { role: 'heading' as const, name: 'Settings' };
// The YouTrack token field; the Claude key field's placeholder starts with "Key".
const TOKEN_FIELD = /^Token saved|Paste your YouTrack permanent token/;

async function openSettings(page: Page) {
  await page.getByLabel('Open Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

test.describe('Settings view', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('the gear opens Settings with sections and a Save/Cancel footer', async () => {
    await openSettings(page);
    await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI (Claude)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timer & Pomodoro' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('Cancel returns to the board', async () => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole(SETTINGS_HEADING.role, { name: SETTINGS_HEADING.name })).toBeHidden();
    await expect(page.locator('[data-testid="nav-project"]').first()).toBeVisible();
  });

  test('Save persists a changed setting and returns to the board', async () => {
    await openSettings(page);
    await page.getByPlaceholder('your.login').fill('e2e-user');
    await page.locator('[data-testid="settings-save-btn"]').click();

    // Save closes the view back to the board.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();
    await expect(page.locator('[data-testid="nav-project"]').first()).toBeVisible();

    // Reopening shows the persisted value (writeConfig round-trips in E2E).
    await openSettings(page);
    await expect(page.getByPlaceholder('your.login')).toHaveValue('e2e-user');
  });

  test('typing a credential then Cancel prompts to discard', async () => {
    await openSettings(page);
    await page.getByPlaceholder(TOKEN_FIELD).fill('new-secret-token');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();

    // Keep editing dismisses the prompt and stays in Settings.
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

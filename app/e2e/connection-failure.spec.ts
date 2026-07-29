/**
 * Recovering from a broken YouTrack connection.
 *
 * Regression for the case where a YouTrack instance is rebuilt and its tokens
 * invalidated. The app's `connected` check only asks whether a token FILE
 * exists, never whether it works — so a stale token routes the user to the
 * board rather than to Settings. The board is then empty, and the only Settings
 * button used to live in the left rail, which itself renders YouTrack-derived
 * data and fails. Net effect: an authentication failure removed the only route
 * to fixing authentication.
 *
 * These tests assert the two escape hatches: a top-bar gear that depends on no
 * remote data, and a banner that explains the failure and offers the fix.
 */

import { test, expect, Page } from '@playwright/test';
import { launchAppWithRevokedToken } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

test.describe('Broken YouTrack connection', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithRevokedToken();
    page = await app.firstWindow();
    // The app considers itself connected (a token file exists), so it renders
    // the shell. Wait on the top bar rather than on any project-derived node —
    // no projects will ever load here.
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('shows a banner naming the token as the problem', async () => {
    const banner = page.locator('[data-testid="connection-error-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/rejected the stored token/i);
    // Must point at the remedy, not just state the failure.
    await expect(banner).toContainText(/Settings/);
  });

  test('the banner offers a route to Settings', async () => {
    await page.locator('[data-testid="connection-error-banner"]')
      .getByRole('button', { name: 'Open Settings' })
      .click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
  });

  test('the top-bar gear reaches Settings even though the rail failed', async () => {
    // The specific trap: this must work without depending on the left rail,
    // which cannot render its project tree when YouTrack rejects the token.
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('Settings opened this way can be closed, returning to the board', async () => {
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Back to the shell, with the banner still up since nothing was fixed.
    await expect(page.locator('[data-testid="connection-error-banner"]')).toBeVisible();
  });
});

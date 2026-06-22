/**
 * Appearance / dark mode (commit e1fde6b). Verifies the Settings theme toggle
 * actually flips the live CSS theme tokens — the dark palette is injected as a
 * <style> targeting .dark-app-theme on the app wrapper.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

function wrapperToken(page: Page, selector: string, token: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, t) => getComputedStyle(el).getPropertyValue(t).trim(),
    token,
  );
}

test.describe('Appearance', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('toggling Dark in Settings flips the theme tokens', async () => {
    // Default is light.
    await expect(page.locator('.light-app-theme').first()).toBeVisible();

    // Open Settings (rail footer gear) and pick Dark.
    await page.locator('[aria-label="Open Settings"]').click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();

    await expect(page.locator('.dark-app-theme').first()).toBeVisible();
    expect(await wrapperToken(page, '.dark-app-theme', '--board-background-color')).toBe('#1b2430');
    expect(await wrapperToken(page, '.dark-app-theme', '--primary-text-color')).toBe('#e6e9f0');

    // Back to Light restores the light surface.
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('.light-app-theme').first()).toBeVisible();
    expect(await wrapperToken(page, '.light-app-theme', '--board-background-color')).toBe('#ffffff');
  });
});

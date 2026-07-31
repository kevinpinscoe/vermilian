/**
 * Regression: creating a new (empty) workspace must not blank out the left rail.
 *
 * An empty workspace makes the board area fall back to the one-line
 * "Select a project from the left rail" placeholder. The rail is absolutely
 * positioned inside a slot that takes its height from that sibling, so if the
 * `height: 100%` chain from #root down to .shell is broken anywhere, the whole
 * rail collapses to the height of that single line and renders blank — leaving
 * no way to switch back to a populated workspace.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

test.describe('Empty workspace keeps the rail usable', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('rail still fills the window after switching to an empty workspace', async () => {
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="new-workspace-btn"]').click();
    await page.locator('[data-testid="new-workspace-input"]').fill('Kevin');
    await page.locator('[data-testid="new-workspace-submit"]').click();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Kevin');

    // The rail must still occupy essentially the full window height, not collapse
    // to the height of the board placeholder text.
    const viewportH = (await page.viewportSize())?.height
      ?? (await page.evaluate(() => window.innerHeight));
    await expect.poll(async () => {
      const box = await page.locator('nav').first().boundingBox();
      return box ? Math.round(box.height) : 0;
    }).toBeGreaterThan(viewportH * 0.5);

    // And its controls must be genuinely visible — this is the only route back
    // to a workspace that has projects.
    await expect(page.locator('[data-testid="workspace-switcher"]')).toBeVisible();
    await expect(page.locator('[data-testid="add-folder-btn"]')).toBeVisible();
  });
});

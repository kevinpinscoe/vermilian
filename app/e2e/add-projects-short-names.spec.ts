/**
 * The workspace project picker shows YouTrack short names, ranks search by
 * them, and refetches the project list when it opens (VERM-120).
 *
 * The real instance has a project, KEVIN, whose long name ("Kevin") is a
 * prefix of its siblings' ("Kevin - PIM", "Kevin - Personal data"). With only
 * long names on screen and alphabetical order, KEVIN looked missing.
 * VERMILIAN_E2E_YT_PREFIX_FIXTURES=1 recreates that shape, KEVIN listed last.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchAppWithEnv } from './helpers/launch';

async function openPicker(page: Page) {
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.locator('[data-testid="new-workspace-btn"]').click();
  await page.locator('[data-testid="new-workspace-input"]').fill('Budget and paydown');
  await page.locator('[data-testid="new-workspace-backend-youtrack"]').click();
  await page.locator('[data-testid="new-workspace-submit"]').click();
  await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Budget and paydown');
  await page.locator('[data-testid="add-projects-btn"]').click();
  await expect(page.locator('[data-testid="add-projects-list"]')).toBeVisible();
}

test.describe('Add projects: short names', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv({ VERMILIAN_E2E_YT_PREFIX_FIXTURES: '1' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('every row shows its short name beside its long name', async () => {
    await openPicker(page);
    const rows = page.locator('[data-testid="add-projects-row"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i++) {
      const key = await rows.nth(i).getAttribute('data-project-key');
      expect(key).toBeTruthy();
      await expect(rows.nth(i).locator('[data-testid="add-projects-key"]')).toHaveText(key as string);
    }
    const kevin = page.locator('[data-testid="add-projects-row"][data-project-key="KEVIN"]');
    await expect(kevin).toContainText('KEVIN');
    await expect(kevin).toContainText('Kevin');
    await expect(kevin.locator('input')).toHaveAttribute('aria-label', 'Kevin (KEVIN)');
  });

  test('typing a short name puts that project first, ahead of look-alike names', async () => {
    await openPicker(page);
    await page.locator('[data-testid="add-projects-search"]').fill('kevin');
    const rows = page.locator('[data-testid="add-projects-row"]');
    // KEVIN by key, then the two whose names merely contain "kevin".
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-project-key', 'KEVIN');
    await expect(rows.nth(1)).toHaveAttribute('data-project-key', 'KPD');
    await expect(rows.nth(2)).toHaveAttribute('data-project-key', 'PIM');
  });

  test('a project renamed in YouTrack shows its new name when the picker opens', async () => {
    await openPicker(page);
    const kevin = page.locator('[data-testid="add-projects-row"][data-project-key="KEVIN"]');
    await expect(kevin).toHaveAttribute('data-project-name', 'Kevin');
    await page.locator('[data-testid="add-projects-save"]').click();
    await expect(page.locator('[data-testid="add-projects-list"]')).toHaveCount(0);

    // Renamed in YouTrack while Vermilian is running — no resync, no restart.
    const renamed = await page.evaluate(
      () => window.vermilian.debugRenameProject?.('KEVIN', 'Kevin personal projects'),
    );
    expect(renamed).toBe(true);

    await page.locator('[data-testid="add-projects-btn"]').click();
    await expect(kevin).toHaveAttribute('data-project-name', 'Kevin personal projects');
    await expect(kevin).toContainText('Kevin personal projects');
  });
});

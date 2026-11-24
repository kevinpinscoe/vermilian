/**
 * Stand-up and Daily Review status discovery (VERM-114), through the real
 * main-process path: each project's Status values are discovered from the
 * fake YouTrack's per-project field configuration, the plan is built from
 * them, and the fake rejects any query naming a value the project does not
 * have (as the live server rejected "Working on it").
 *
 * TST2 is seeded with its own workflow (Open / Doing / Closed): it has no
 * BLOCKED state, so the stand-up must still generate from the other groups
 * and name TST2's missing blocked mapping.
 */

import { test, expect, Page } from '@playwright/test';
import { launchAppWithUserDataDir, freshUserDataDir } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

const STATUS_BUNDLES = JSON.stringify({
  TST2: [
    { name: 'Open', isResolved: false },
    { name: 'Doing', isResolved: false },
    { name: 'Closed', isResolved: true },
  ],
});

test.describe('Stand-up status discovery (VERM-114)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_YT_STATUS_BUNDLES: STATUS_BUNDLES });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="standup-btn"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('generates from the discovered states and names the project with no blocked state', async () => {
    await page.locator('[data-testid="standup-btn"]').click();
    await page.locator('[data-testid="standup-generate-btn"]').click();

    const body = page.locator('[data-testid="standup-report-body"]');
    await expect(body).toBeVisible();
    await expect(body).toContainText('TEST-1');
    await expect(body).toContainText('Refactoring the API client');
    // TST2-2 is BLOCKED, a value TST2 no longer has: not reported.
    await expect(body).not.toContainText('Waiting on a vendor response');

    const warnings = page.locator('[data-testid="standup-mapping-warnings"]');
    await expect(warnings).toContainText('TST2: no Status value is mapped to blocked');
  });

  test('Daily Review loads completed work through the same discovery', async () => {
    await page.locator('[data-testid="daily-review-btn"]').click();
    await expect(page.locator('#daily-review-modal')).toBeVisible();
    await expect(page.locator('[data-testid="daily-review-completed-TEST-1"]')).toBeVisible({ timeout: 15_000 });
    // A missing blocked state does not affect completed work, so no warning.
    await expect(page.locator('[data-testid="daily-review-mapping-warnings"]')).toHaveCount(0);
  });
});

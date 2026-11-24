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
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

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

// Daily Review's completed work is bound to, and cached by, the workspace it
// was opened in (VERM-114 review). Workspace A reads TEST and its answer is
// held; workspace B reads TST2 (a Closed ticket) and INB (no done state, so a
// warning). Opening A, then B before A answers, then A again inside the cache
// window must show each workspace only its own tickets and warnings.
test.describe('Daily Review per workspace (VERM-114 review)', () => {
  let app: ElectronApplication;
  let page: Page;
  const tid = (id: string) => page.locator(`[data-testid="${id}"]`);
  const doc = (workspaceId: string, name: string, order: number, projectIds: string[], ytRef: string): WorkspaceDocument => ({
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name,
    order,
    backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: ytRef },
    ai: { credentialRef: 'anthropic-e2e' },
    masterPlan: { articleId: null },
    folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds }],
    boards: {},
    dismissals: {},
  });

  async function switchTo(name: string) {
    await tid('workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    await expect(tid('workspace-switcher')).toContainText(name);
  }
  async function openReview() {
    await tid('daily-review-btn').click();
    await expect(page.locator('#daily-review-modal')).toBeVisible();
  }
  async function closeReview() {
    await page.keyboard.press('Escape');
    await expect(page.locator('#daily-review-modal')).toHaveCount(0);
  }

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_YT_STATUS_BUNDLES: JSON.stringify({
        TST2: [{ name: 'Open', isResolved: false }, { name: 'Doing', isResolved: false }, { name: 'Closed', isResolved: true }],
        INB: [{ name: 'Open', isResolved: false }, { name: 'Doing', isResolved: false }],
      }),
      VERMILIAN_E2E_STANDUP_EXTRA_FIXTURES: JSON.stringify([{ idReadable: 'TST2-7', summary: 'Closed the vendor contract', status: 'Closed' }]),
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const d of [doc('ws-e2edr1', 'Home DR', 0, ['0-e1'], 'youtrack-home'), doc('ws-e2edr2', 'Work DR', 1, ['0-e2', '0-e3'], 'youtrack-work')]) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(tid('workspace-switcher')).toBeVisible({ timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test("a late answer for A never fills B's view, and each workspace keeps its own tickets and warnings", async () => {
    await switchTo('Home DR');
    // Hold every read that includes TEST (workspace A's only project).
    await page.evaluate(() => window.vermilian.debugSetStandupDelay!(4000, 'TEST'));
    await openReview();
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.debugGetStandupQueries!())).some((q) => q.includes('TEST'))).toBe(true);
    await expect(tid('daily-review-completed-TEST-1')).toHaveCount(0); // A is still loading
    await closeReview();

    // B, before A has answered.
    await switchTo('Work DR');
    await openReview();
    const completed = tid('daily-review-completed');
    await expect(tid('daily-review-completed-TST2-7')).toContainText('Closed the vendor contract', { timeout: 15_000 });
    await expect(tid('daily-review-mapping-warnings')).toContainText('INB: no Status value is mapped to done');

    // Let A's held answer arrive while B is showing.
    await page.waitForTimeout(4500);
    await expect(completed).not.toContainText('Finished the login flow');
    await expect(tid('daily-review-completed-TEST-1')).toHaveCount(0);
    await expect(tid('daily-review-completed-TST2-7')).toContainText('Closed the vendor contract');
    await expect(tid('daily-review-mapping-warnings')).toContainText('INB: no Status value is mapped to done');
    await closeReview();

    // Back to A inside the cache window: A's own ticket, and none of B's warnings.
    await switchTo('Home DR');
    await openReview();
    await expect(tid('daily-review-completed-TEST-1')).toContainText('Finished the login flow', { timeout: 15_000 });
    await expect(completed).not.toContainText('Closed the vendor contract');
    await expect(tid('daily-review-mapping-warnings')).toHaveCount(0);
  });
});

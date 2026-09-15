/**
 * Priority Desk Foundation (VERM-4, ADR-0007): the Focus star + rank badge
 * (FocusControl) and the Focus-rank invariant. Fake YouTrack: TEST project
 * issues 0-e1-1..6 start unfocused (see fakeYouTrack.ts's emptyFields()).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Focus toggle and Focus-rank invariant', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('starring a task shows an unranked badge; unstarring hides it again', async () => {
    const star = page.locator('[data-testid="focus-star-0-e1-1"]');
    await expect(star).toBeVisible();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveCount(0);

    await star.click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('–');

    await star.click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveCount(0);
  });

  test('picking a free rank assigns it directly, no conflict dialog', async () => {
    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-1-2"]').click();

    await expect(page.locator('[data-testid="focus-rank-conflict-dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('2');
  });

  test('Clear rank empties the rank but leaves the issue starred', async () => {
    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-1-1"]').click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('1');

    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-clear-0-e1-1"]').click();

    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('–');
  });

  test('assigning an already-held rank asks which issue keeps it', async () => {
    // TEST-1 takes rank 1.
    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-1-1"]').click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('1');

    // TEST-2 also asks for rank 1 — a normal conflict.
    await page.locator('[data-testid="focus-star-0-e1-2"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-2"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-2-1"]').click();

    const dialog = page.locator('[data-testid="focus-rank-conflict-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('TEST-1');

    // Cancel ("Keep TEST-1") changes nothing.
    await page.locator('[data-testid="focus-rank-conflict-keep"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('1');
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-2"]')).toHaveText('–');

    // Re-ask and confirm this time — TEST-2 takes the rank, TEST-1 becomes unranked
    // (but stays starred: its badge is still present, showing "–").
    await page.locator('[data-testid="focus-rank-badge-0-e1-2"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-2-1"]').click();
    await page.locator('[data-testid="focus-rank-conflict-move"]').click();

    await expect(page.locator('[data-testid="focus-rank-conflict-dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-2"]')).toHaveText('1');
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('–');
  });

  test('a rank shared by two issues from outside the UI surfaces the repair banner, never auto-resolved', async () => {
    // Simulate stale/external state: two issues given the same rank directly
    // through the IPC surface, bypassing FocusControl's own conflict check —
    // the scenario the ADR names explicitly (another client, or a web UI edit).
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focusRank', value: 3 });
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focusRank', value: 3 });
    });
    await page.reload();
    await navigateToFirstProject(page);

    const banner = page.locator('[data-testid="focus-rank-repair-banner"]');
    await expect(banner).toBeVisible();
    const repairRank3 = page.locator('[data-testid="focus-rank-repair-3"]');
    await expect(repairRank3).toBeVisible();
    await expect(repairRank3).toContainText('held by 2 issues');

    // The picker refuses to add a third claimant to the disputed rank.
    await page.locator('[data-testid="focus-star-0-e1-3"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-3"]').click();
    await expect(page.locator('[data-testid="focus-rank-option-0-e1-3-3"]')).toBeDisabled();
    await page.locator('[data-testid="focus-rank-menu-backdrop-0-e1-3"]').click();

    // Resolve it: keep TEST-1 at rank 3.
    await page.locator('[data-testid="focus-rank-repair-keep-0-e1-1"]').click();

    await expect(banner).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('3');
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-2"]')).toHaveText('–');
  });

  test('the Kanban card and task detail panel expose the same Focus control', async () => {
    await page.locator('[data-testid="view-tab"][data-view-type="kanban"]').click();
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible();
    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toBeVisible();

    await page.locator('[data-testid="view-tab"][data-view-type="table"]').click();
    await page.locator('[data-task-id="0-e1-1"] [data-testid="issue-id"]').click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-detail-panel"] [data-testid="focus-star-0-e1-1"]')).toBeVisible();
  });
});

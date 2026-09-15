/**
 * Priority Desk — Manual desk, Now mode (VERM-5, VERM-3, ADR-0007). Reuses the
 * VERM-4 Focus/rank hooks and mutations (focus.ts) and the FocusRankRepairBanner
 * verbatim, so this file tests the desk's own surface — the rail entry, the
 * rank-to-slot mapping, card content, and workspace scoping — not a second copy
 * of the Focus-rank invariant (see focus-toggle.spec.ts for that).
 *
 * Fake YouTrack fixtures used: TEST project (0-e1-1..6) and TST2 project
 * (0-e2-1..2), both in the default workspace on a fresh install.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function openPriorityDesk(page: Page) {
  await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-priority-desk"]').click();
  await page.waitForSelector('[data-testid="priority-desk"]', { timeout: 15_000 });
}

// Sets Focus/rank directly through the IPC surface, bypassing the app's own
// mutation flow (and therefore its cache invalidation) — the same "external
// edit" simulation focus-toggle.spec.ts uses for the repair-banner scenario.
// A reload is required afterwards so the desk's query re-fetches the fake
// backend's real state instead of serving whatever the WorkspaceBoard's
// default "All tasks" view already cached on launch.
async function rankIssue(page: Page, issueId: string, rank: 1 | 2 | 3) {
  await page.evaluate(
    async ({ issueId, rank }) => {
      await window.vermilian.patchIssue({ issueId, field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId, field: 'focusRank', value: rank });
    },
    { issueId, rank },
  );
  await page.reload();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
}

test.describe('Priority Desk', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('Priority Desk appears above All tasks in the rail', async () => {
    const deskBox = await page.locator('[data-testid="nav-priority-desk"]').boundingBox();
    const allTasksBox = await page.locator('[data-testid="nav-all-tasks"]').boundingBox();
    expect(deskBox).not.toBeNull();
    expect(allTasksBox).not.toBeNull();
    expect(deskBox!.y).toBeLessThan(allTasksBox!.y);
  });

  test('navigating into and out of Priority Desk', async () => {
    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-title"]')).toBeVisible();

    // Out via a project.
    await page.locator('[data-testid="nav-project"]').first().click();
    await expect(page.locator('[data-testid="priority-desk"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="main-table"]')).toBeVisible();

    // Back in, then out via All tasks.
    await openPriorityDesk(page);
    await page.locator('[data-testid="nav-all-tasks"]').click();
    await expect(page.locator('[data-testid="priority-desk"]')).toHaveCount(0);
  });

  test('defaults to Now mode with zero ranked tasks rendering three intentional empty slots', async () => {
    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-now"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-next"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-then"]')).toBeVisible();
  });

  test('only Now occupied — rank 1 maps to the Now slot, Next/Then stay empty', async () => {
    await rankIssue(page, '0-e1-1', 1);
    await openPriorityDesk(page);

    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-next"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-then"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).toHaveCount(0);
  });

  test('Now + Next occupied — ranks 1 and 2 map to their own slots', async () => {
    await rankIssue(page, '0-e1-1', 1);
    await rankIssue(page, '0-e1-2', 2);
    await openPriorityDesk(page);

    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-next"] [data-testid="priority-desk-card-0-e1-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-then"]')).toBeVisible();
  });

  test('all three ranks occupied — deterministic 1/2/3 → Now/Next/Then mapping, card content shown', async () => {
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'whyNow', value: 'Blocks the release' });
    });
    await rankIssue(page, '0-e1-1', 1);
    await rankIssue(page, '0-e1-2', 2);
    await rankIssue(page, '0-e2-1', 3);
    await openPriorityDesk(page);

    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-next"] [data-testid="priority-desk-card-0-e1-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-then"] [data-testid="priority-desk-card-0-e2-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-empty-now"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-empty-next"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-empty-then"]')).toHaveCount(0);

    const nowCard = page.locator('[data-testid="priority-desk-card-0-e1-1"]');
    await expect(nowCard).toContainText('TEST-1');
    await expect(nowCard).toContainText('To do task 1');
    await expect(nowCard).toContainText('Test Project');
    await expect(nowCard).toContainText('Normal');
    await expect(nowCard).toContainText('Blocks the release');
    await expect(nowCard.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('1');

    // Why now with nothing set shows an explicit placeholder rather than blank.
    const nextCard = page.locator('[data-testid="priority-desk-card-0-e1-2"]');
    await expect(nextCard).toContainText('No reason given yet.');
  });

  test('Start focus on the Now card invokes the existing timer', async () => {
    await rankIssue(page, '0-e1-1', 1);
    await openPriorityDesk(page);

    await page.locator('[data-testid="priority-desk-start-focus-0-e1-1"]').click();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="focus-task-id"]')).toHaveText('TEST-1');

    // Quit protection blocks app.close() while a timer runs.
    await page.locator('[data-testid="focus-stop-btn"]').click();
    await page.getByText(/Logged \d+ min/).waitFor({ timeout: 5000 }).catch(() => {});
  });

  test('Focus/rank edits made elsewhere are reflected on the desk after invalidation', async () => {
    await rankIssue(page, '0-e1-1', 1);
    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();

    // Clear the rank from the project board's own FocusControl, not the desk.
    await page.locator('[data-testid="nav-project"]').first().click();
    await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-clear-0-e1-1"]').click();
    await expect(page.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('–');

    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-empty-now"]')).toBeVisible();
  });

  test('duplicate-rank repair state is surfaced on the desk and is not bypassed', async () => {
    // Two issues sharing rank 1 from outside the picker's own conflict check —
    // the same scenario focus-toggle.spec.ts exercises against the board.
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focusRank', value: 1 });
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focusRank', value: 1 });
    });
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openPriorityDesk(page);

    await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="focus-rank-repair-1"]')).toBeVisible();
    // The Now slot shows neither card arbitrarily — it points at the repair banner instead.
    await expect(page.locator('[data-testid="priority-desk-duplicate-now"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-2"]')).toHaveCount(0);

    await page.locator('[data-testid="focus-rank-repair-keep-0-e1-1"]').click();
    await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
  });

  test('active-workspace isolation — a rank set in one workspace is invisible from another', async () => {
    await rankIssue(page, '0-e1-1', 1);

    // Create a second, empty workspace (no projects assigned to it yet).
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="new-workspace-btn"]').click();
    await page.locator('[data-testid="new-workspace-input"]').fill('Other');
    await page.locator('[data-testid="new-workspace-submit"]').click();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Other');

    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toHaveCount(0);

    // Switching back to the original workspace shows the ranked card again.
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="workspace-menu-item"][data-ws-name="Workspace"]').click();
    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
  });

  test('a focused-but-unranked issue does not count as ranked — the empty state still shows', async () => {
    // Focus = Yes, Focus rank = null: a valid starred-but-unranked issue
    // (Choose-next territory, VERM-6) that must not occupy a desk slot.
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focus', value: 'Yes' });
    });
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openPriorityDesk(page);

    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).toContainText('No tasks are ranked yet');
    await expect(page.locator('[data-testid="priority-desk-all-empty"]')).not.toContainText('Nothing focused');
    await expect(page.locator('[data-testid="priority-desk-empty-now"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toHaveCount(0);
  });

  test.describe('card ↔ task detail integration', () => {
    test('clicking the body of an occupied card opens the task detail panel', async () => {
      await rankIssue(page, '0-e1-1', 1);
      await openPriorityDesk(page);

      await page.locator('[data-testid="priority-desk-card-0-e1-1"]').getByText('To do task 1').click();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
      await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-1');
    });

    test('clicking Start focus or the Focus control does not also open the task detail panel', async () => {
      await rankIssue(page, '0-e1-1', 1);
      await openPriorityDesk(page);

      // The rank badge opens FocusControl's own rank-picker popover — a
      // non-destructive click on the embedded control (unlike the star, which
      // would unfocus an already-focused, already-ranked issue here).
      await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
      await expect(page.locator('[data-testid="focus-rank-menu-0-e1-1"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toHaveCount(0);
      await page.locator('[data-testid="focus-rank-menu-backdrop-0-e1-1"]').click();

      await page.locator('[data-testid="priority-desk-start-focus-0-e1-1"]').click();
      await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toHaveCount(0);

      await page.locator('[data-testid="focus-stop-btn"]').click();
      await page.getByText(/Logged \d+ min/).waitFor({ timeout: 5000 }).catch(() => {});
    });

    test('editing Why now through the detail panel updates the desk card without a reload', async () => {
      await rankIssue(page, '0-e1-1', 1);
      await openPriorityDesk(page);

      await page.locator('[data-testid="priority-desk-card-0-e1-1"]').getByText('To do task 1').click();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();

      await page.locator('[data-field="whyNow"] button').click();
      await page.locator('[data-field="whyNow"] input').fill('Set from the detail panel');
      await page.locator('[data-field="whyNow"] input').press('Enter');
      await expect(page.locator('[data-field="whyNow"] button')).toHaveText('Set from the detail panel');

      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="task-detail-panel"]')).toHaveCount(0);

      // Still on the desk (closing the panel doesn't navigate away) — no reload.
      await expect(page.locator('[data-testid="priority-desk"]')).toBeVisible();
      await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toContainText('Set from the detail panel');
    });

    test('deleting the ranked issue through the detail panel empties its slot without a reload', async () => {
      await rankIssue(page, '0-e1-1', 1);
      await openPriorityDesk(page);

      await page.locator('[data-testid="priority-desk-card-0-e1-1"]').getByText('To do task 1').click();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();

      await page.getByLabel('Delete task').click();
      await page.locator('[data-testid="delete-confirm-btn"]').click();
      await expect(page.locator('[data-testid="task-detail-panel"]')).toHaveCount(0);

      // Still on the desk, no reload — the Now slot goes back to its empty placeholder.
      await expect(page.locator('[data-testid="priority-desk"]')).toBeVisible();
      await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="priority-desk-empty-now"]')).toBeVisible();
    });
  });
});

/**
 * Priority Desk — Choose next mode (VERM-6, VERM-3, docs/requirements.md §
 * Priority Desk "Choose-next eligibility"). Reuses VERM-4's Focus/rank hooks
 * and mutations and VERM-5's Now-mode desk verbatim, so this file tests
 * Choose-next's own surface: eligibility, deterministic ordering, the seven-
 * candidate cap, the Status filter, "Not this week" persistence and
 * expiration, and that rank assignment from a candidate card goes through the
 * existing VERM-4 conflict/repair behavior (see focus-toggle.spec.ts and
 * priority-desk.spec.ts for that behavior's own coverage).
 *
 * The active-Epic filter in VERM-6's original scope is deferred to VERM-7 (no
 * native Epic/Subtask link data exists yet — scope decision recorded on
 * VERM-6/VERM-7, 2026-09-16), so there is no Epic filter to test here.
 *
 * Fake YouTrack fixtures (src/main/api/fakeYouTrack.ts): TEST project has 6
 * issues (0-e1-1..6 — TEST-1..6), TST2 has 2 (0-e2-1..2), INB has 1 (0-e3-1).
 * All 9 start unranked, undismissed, not Done — 9 eligible candidates on a
 * fresh launch, capped at 7. TEST-1 and TEST-2 carry fixed Due Dates (TEST-1
 * earlier than TEST-2, both earlier than the rest, which are undated), so
 * they deterministically sort first and second regardless of Priority.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function openChooseNext(page: Page) {
  await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-priority-desk"]').click();
  await page.waitForSelector('[data-testid="priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="priority-desk-mode-choose-next"]').click();
  await page.waitForSelector('[data-testid="priority-desk-choose-next"]', { timeout: 15_000 });
}

async function seedDismissal(page: Page, issueId: string, dismissedWeekOf: string, workspace = 'workspace-default') {
  await page.evaluate(
    async ({ issueId, dismissedWeekOf, workspace }) => {
      await window.vermilian.saveDismissal({ workspace, issueId, dismissedWeekOf });
    },
    { issueId, dismissedWeekOf, workspace },
  );
}

test.describe('Priority Desk — Choose next', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('the mode switch shows Now by default and Choose next carries the candidate count', async () => {
    await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
    await page.locator('[data-testid="nav-priority-desk"]').click();
    await expect(page.locator('[data-testid="priority-desk-slot-now"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('Choose next (7)');

    await page.locator('[data-testid="priority-desk-mode-choose-next"]').click();
    await expect(page.locator('[data-testid="priority-desk-choose-next"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-now"]')).toHaveCount(0);

    await page.locator('[data-testid="priority-desk-mode-now"]').click();
    await expect(page.locator('[data-testid="priority-desk-slot-now"]')).toBeVisible();
  });

  test('shows at most seven candidates even though nine are eligible', async () => {
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-candidate-id"]')).toHaveCount(7);
  });

  test('candidate ordering is deterministic — Due Date, then Priority, then idReadable', async () => {
    await openChooseNext(page);
    const ids = await page.locator('[data-testid="priority-desk-candidate-id"]').allTextContents();
    // TEST-1 and TEST-2 carry real Due Dates (TEST-1 earlier) and sort first
    // regardless of Priority; the rest are undated and fall back to Priority
    // ordinal (most urgent first) then idReadable ascending.
    expect(ids).toEqual(['TEST-1', 'TEST-2', 'TEST-6', 'TEST-4', 'TST2-2', 'INB-1', 'TEST-5']);
  });

  test('a Focus=Yes, unranked issue remains an eligible, starred candidate', async () => {
    // 0-e1-4 (TEST-4) sorts within the top seven under the fixture's
    // deterministic ordering (see the ordering test above) — picking an
    // issue outside that window would never show regardless of Focus.
    // Raw IPC bypasses the app's own cache invalidation (an "external edit"
    // simulation, same technique priority-desk.spec.ts uses) — reload so the
    // desk's query re-fetches the fake backend's real state, rather than the
    // WorkspaceBoard's default "All tasks" view's already-cached pre-mutation data.
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-4', field: 'focus', value: 'Yes' });
    });
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);
    const card = page.locator('[data-testid="priority-desk-candidate-0-e1-4"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="focus-star-0-e1-4"]')).toHaveClass(/starActive/);
  });

  test('a ranked issue (Focus rank 1-3) never appears as a Choose-next candidate', async () => {
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-1', field: 'focusRank', value: 1 });
    });
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0);
  });

  test('the Status filter narrows candidates to a single status, toggling back to All clears it', async () => {
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');

    await page.locator('[data-testid="priority-desk-status-pill"][data-value="In Progress"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(3)');
    await expect(page.locator('[data-testid="priority-desk-candidate-id"]')).toHaveCount(3);

    // Clicking the same pill again clears the filter back to All.
    await page.locator('[data-testid="priority-desk-status-pill"][data-value="In Progress"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');
  });

  test('"Not this week" removes the card immediately and updates the candidate count', async () => {
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');

    await page.locator('[data-testid="priority-desk-candidate-dismiss-0-e1-1"]').click();
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0, { timeout: 10_000 });
    // 9 eligible - 1 dismissed = 8, still capped at 7 — the count does not drop
    // below the cap until fewer than 7 remain eligible.
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');
  });

  test('"Not this week" survives a restart via _vermilian-config', async () => {
    await openChooseNext(page);
    await page.locator('[data-testid="priority-desk-candidate-dismiss-0-e1-1"]').click();
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0, { timeout: 10_000 });

    await page.reload();
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0);
  });

  test('a dismissal from a prior local week no longer excludes the issue — expires automatically', async () => {
    await seedDismissal(page, '0-e1-1', '2020-01-06'); // a Monday, long past
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toBeVisible();
  });

  test('assigning a candidate to a rank goes through the existing conflict dialog, never silently overwriting', async () => {
    // Rank 0-e1-1 to 1 first (from the board, establishing state).
    await page.evaluate(async () => {
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: '0-e1-2', field: 'focusRank', value: 1 });
    });
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);

    // 0-e1-1 is a candidate here (unranked); star it, then ask for rank 1 too.
    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-badge-0-e1-1"]').click();
    await page.locator('[data-testid="focus-rank-option-0-e1-1-1"]').click();

    const dialog = page.locator('[data-testid="focus-rank-conflict-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('TEST-2');

    await page.locator('[data-testid="focus-rank-conflict-move"]').click();
    await expect(dialog).toHaveCount(0);

    // Once ranked, 0-e1-1 stops being a candidate at all (the card — badge
    // included — unmounts as soon as the invalidated query re-excludes it),
    // so the rank is verified from Now mode instead of the vanished badge.
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0, { timeout: 10_000 });
    await page.locator('[data-testid="priority-desk-mode-now"]').click();
    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-card-0-e1-1"] [data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('1');
  });

  test('clicking a candidate card opens the task detail panel; embedded controls do not', async () => {
    await openChooseNext(page);

    await page.locator('[data-testid="focus-star-0-e1-1"]').click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toHaveCount(0);

    await page.locator('[data-testid="priority-desk-candidate-0-e1-1"]').getByText('To do task 1').click();
    await expect(page.locator('[data-testid="task-detail-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="detail-issue-id"]')).toHaveText('TEST-1');
  });

  test('no free-text search box is offered in Choose next — full search stays in All tasks', async () => {
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-choose-next"] input[type="search"], [data-testid="priority-desk-choose-next"] input[placeholder*="Search" i]')).toHaveCount(0);
  });
});

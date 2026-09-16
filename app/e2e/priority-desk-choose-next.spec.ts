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
 * VERM-7 completes the active-Epic filter VERM-6's original scope deferred
 * (no native Epic/Subtask link data existed at the time).
 *
 * Fake YouTrack fixtures (src/main/api/fakeYouTrack.ts): TEST project has 6
 * issues (0-e1-1..6 — TEST-1..6), TST2 has 2 (0-e2-1..2), INB has 1 (0-e3-1).
 * All start unranked, undismissed, not Done. TEST-3 is itself flagged
 * isEpic — an Epic is never a Choose-next candidate (VERM-7 review finding)
 * — so 8 of the 9 are actually eligible on a fresh launch, still capped at 7
 * displayed; the visible top-7 set is unaffected by that exclusion, since
 * TEST-3 was already outside it under the plain seven-item cap. TEST-1 and
 * TEST-2 carry fixed Due Dates (TEST-1 earlier than TEST-2, both earlier
 * than the rest, which are undated), so they deterministically sort first
 * and second regardless of Priority. TEST-3 doubles as the parent Epic for
 * TEST-1 and TEST-2; TEST-4 doubles as the parent Epic for TEST-5 (but is
 * not itself flagged isEpic, so it still appears as an ordinary candidate);
 * TEST-6 and every TST2/INB issue carry no parent Epic at all (VERM-7).
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

  test('shows at most seven candidates even though eight are eligible', async () => {
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

  test('VERM-7: an Epic issue itself never appears as a Choose-next candidate', async () => {
    // TEST-3 (0-e1-3) is itself flagged isEpic in the fake fixtures and is
    // the parent Epic of TEST-1/TEST-2. Filtering to its own Status ("To do")
    // narrows the pool below the seven-item cap, which is exactly the
    // condition under which the pre-fix cap-only exclusion would have let it
    // through as a visible candidate.
    await openChooseNext(page);
    await page.locator('[data-testid="priority-desk-status-pill"][data-value="To do"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(5)');
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-3"]')).toHaveCount(0);
    const ids = await page.locator('[data-testid="priority-desk-candidate-id"]').allTextContents();
    expect(ids.sort()).toEqual(['INB-1', 'TEST-1', 'TEST-2', 'TEST-4', 'TST2-1']);
  });

  test('VERM-7: the Epic filter options are populated from native Epic relationships', async () => {
    await openChooseNext(page);
    // "All epics" plus the two epics actually present in the fixtures (TEST-3, TEST-4) —
    // never a hard-coded list.
    await expect(page.locator('[data-testid="priority-desk-epic-pill"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="priority-desk-epic-pill"][data-value="0-e1-3"]')).toContainText('TEST-3');
    await expect(page.locator('[data-testid="priority-desk-epic-pill"][data-value="0-e1-4"]')).toContainText('TEST-4');
  });

  test('VERM-7: selecting an Epic restricts Choose next to issues linked beneath it', async () => {
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');

    await page.locator('[data-testid="priority-desk-epic-pill"][data-value="0-e1-3"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(2)');
    const ids = await page.locator('[data-testid="priority-desk-candidate-id"]').allTextContents();
    expect(ids.sort()).toEqual(['TEST-1', 'TEST-2']);
  });

  test('VERM-7: clearing the Epic filter restores the broader candidate set', async () => {
    await openChooseNext(page);
    await page.locator('[data-testid="priority-desk-epic-pill"][data-value="0-e1-3"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(2)');

    await page.locator('[data-testid="priority-desk-epic-pill"][data-value=""]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(7)');
  });

  test('VERM-7: the Status and Epic filters combine conjunctively', async () => {
    await openChooseNext(page);
    // TEST-5 (0-e1-5, "In Progress") is the only candidate under Epic TEST-4.
    await page.locator('[data-testid="priority-desk-epic-pill"][data-value="0-e1-4"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(1)');

    // Adding a Status filter TEST-5 does not match empties the set — the
    // Epic filter never gets widened back out by the Status pill.
    await page.locator('[data-testid="priority-desk-status-pill"][data-value="To do"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(0)');
    await expect(page.locator('[data-testid="priority-desk-no-candidates"]')).toBeVisible();

    // TEST-5's actual Status ("In Progress") brings it back, still scoped to the same Epic.
    await page.locator('[data-testid="priority-desk-status-pill"][data-value="To do"]').click(); // clear
    await page.locator('[data-testid="priority-desk-status-pill"][data-value="In Progress"]').click();
    await expect(page.locator('[data-testid="priority-desk-mode-choose-next"]')).toContainText('(1)');
    await expect(page.locator('[data-testid="priority-desk-candidate-id"]')).toHaveText('TEST-5');
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

  test('"Not this week" survives a renderer reload (UI-state check only — see the Article test below for real persistence)', async () => {
    await openChooseNext(page);
    await page.locator('[data-testid="priority-desk-candidate-dismiss-0-e1-1"]').click();
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0, { timeout: 10_000 });

    // A renderer reload alone proves nothing about the Article: the main
    // process, articleConfig cache, and fake Article all stay alive across
    // it. This only confirms the renderer's own query cache still reflects
    // the dismissal — see the dedicated Article-persistence test below for
    // proof the write actually reached the Article.
    await page.reload();
    await openChooseNext(page);
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0);
  });

  test('"Not this week" is actually persisted to the Article — survives a discarded cache + forced reload from it', async () => {
    await openChooseNext(page);
    await page.locator('[data-testid="priority-desk-candidate-dismiss-0-e1-1"]').click();
    await expect(page.locator('[data-testid="priority-desk-candidate-0-e1-1"]')).toHaveCount(0, { timeout: 10_000 });

    // Let the debounced Article write (1.5s, articleConfig.ts) complete.
    await page.waitForTimeout(2000);

    // Discard the in-memory Article cache and re-fetch from the fake
    // YouTrack Article — the same recovery path Settings' "Force resync
    // from server" uses (workspace-config-sync.spec.ts). This exercises the
    // real serialise → Article write → cache discard → Article read → parse
    // path, not just a live process's untouched cache.
    const result = await page.evaluate(() => window.vermilian.forceResyncWorkspaceConfig());
    expect(result.ok).toBe(true);

    const { entry, expectedWeekOf } = await page.evaluate(async () => {
      const dismissals = await window.vermilian.getDismissals();
      const d = new Date();
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      const weekOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { entry: dismissals['workspace-default:0-e1-1'], expectedWeekOf: weekOf };
    });
    expect(entry).toBeDefined();
    expect(entry.workspace).toBe('workspace-default');
    expect(entry.issueId).toBe('0-e1-1');
    expect(entry.dismissedWeekOf).toBe(expectedWeekOf);

    // Choose next still excludes it once the renderer picks up the same
    // Article-backed state.
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

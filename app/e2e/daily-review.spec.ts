/**
 * Priority Desk Daily Review (VERM-9, docs/requirements.md § Priority Desk).
 * Runs against the in-memory fake YouTrack (VERMILIAN_E2E=1): no Claude call
 * is involved anywhere in this feature (PLAN.md "Design decisions" — no
 * Claude, no scoring). Fake fixtures used: TEST project (0-e1-1..6), see
 * fakeYouTrack.ts.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp, launchAppWithUserDataDir, freshUserDataDir } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function openDailyReview(page: Page) {
  await page.locator('[data-testid="daily-review-btn"]').click();
  await expect(page.locator('#daily-review-modal')).toBeVisible();
  await page.waitForSelector('[data-testid="daily-review-body"]', { timeout: 15_000 });
}

// Sets Focus/rank and (optionally) Status directly through the IPC surface,
// the same "external edit" pattern priority-desk.spec.ts's rankIssue() uses,
// then reloads so the app's own queries re-fetch the fake backend's real
// state instead of serving whatever was cached on launch.
async function setIssueState(
  page: Page,
  issueId: string,
  opts: { focus?: 'Yes' | null; focusRank?: 1 | 2 | 3 | null; status?: string },
) {
  await page.evaluate(
    async ({ issueId, opts }) => {
      if (opts.focus !== undefined) {
        await window.vermilian.patchIssue({ issueId, field: 'focus', value: opts.focus });
      }
      if (opts.focusRank !== undefined) {
        await window.vermilian.patchIssue({ issueId, field: 'focusRank', value: opts.focusRank });
      }
      if (opts.status !== undefined) {
        await window.vermilian.patchIssue({ issueId, field: 'status', value: opts.status });
      }
    },
    { issueId, opts },
  );
  await page.reload();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
}

test.describe('Daily Review', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="daily-review-btn"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('opens from the top bar beside Stand-up', async () => {
    await expect(page.locator('[data-testid="standup-btn"]')).toBeVisible();
    await openDailyReview(page);
    await expect(page.locator('#daily-review-modal')).toContainText('Daily Review');
  });

  test('recently completed shows the fake Stand-up "done" fixture', async () => {
    await openDailyReview(page);
    const completed = page.locator('[data-testid="daily-review-completed"]');
    await expect(completed).toContainText('TEST-1');
    await expect(completed).toContainText('Finished the login flow');
  });

  test('no-focused-work: Now/Next/Then all show Empty, needs-attention is empty', async () => {
    await openDailyReview(page);
    await expect(page.locator('[data-testid="daily-review-focus-slots-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="daily-review-needs-attention-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="daily-review-blocked-empty"]')).toBeVisible();
  });

  test('populated: a ranked issue appears in its Now/Next/Then slot', async () => {
    await setIssueState(page, 'TEST-1', { focus: 'Yes', focusRank: 1 });
    await openDailyReview(page);
    const nowSlot = page.locator('[data-testid="daily-review-slot-now"]');
    await expect(nowSlot).toContainText('TEST-1');
  });

  test('blocked focused work: a ranked + BLOCKED issue appears in its own section', async () => {
    await setIssueState(page, 'TEST-2', { focus: 'Yes', focusRank: 2, status: 'BLOCKED' });
    await openDailyReview(page);
    const blocked = page.locator('[data-testid="daily-review-blocked"]');
    await expect(blocked).toContainText('TEST-2');
    // Still shows up in its Next slot too — Daily Review doesn't hide it there.
    await expect(page.locator('[data-testid="daily-review-slot-next"]')).toContainText('TEST-2');
  });

  test('needs attention: a starred-but-unranked issue appears, a ranked one does not', async () => {
    await setIssueState(page, 'TEST-5', { focus: 'Yes' });
    await openDailyReview(page);
    const needsAttention = page.locator('[data-testid="daily-review-needs-attention"]');
    await expect(needsAttention).toContainText('TEST-5');
    await expect(needsAttention.locator('[data-testid^="daily-review-needs-attention-issue-"]')).toHaveCount(1);
  });

  test('agent-work sections render as unavailable, not fabricated data', async () => {
    await openDailyReview(page);
    for (const testId of [
      'daily-review-agent-awaiting-review',
      'daily-review-agent-needing-input',
      'daily-review-agent-failed',
    ]) {
      await expect(page.locator(`[data-testid="${testId}"]`)).toContainText(
        "isn't set up yet",
      );
    }
  });
});

test.describe('Daily Review — API error', () => {
  test('a failed completed-work fetch surfaces an error, not a blank panel', async () => {
    const app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_DAILY_REVIEW_ERROR: '1',
    });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="daily-review-btn"]', { timeout: 15_000 });
    await openDailyReview(page);
    await expect(page.locator('[data-testid="daily-review-error"]')).toBeVisible();
    await app.close();
  });
});

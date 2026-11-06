/**
 * Task timer (task-timer.md). Runs against the in-memory fake YouTrack
 * (VERMILIAN_E2E=1); the fake postWorklog is a no-op that succeeds, so Stop &
 * log completes. Phase transitions are driven by the explicit Skip controls
 * rather than by waiting out the (minutes-long) real durations, so the flow is
 * deterministic: start → pause/resume → skip to break → skip break → stop.
 *
 * Phase-transition tests start the timer from the board row (no detail panel
 * open) because the detail panel would render over the top break banner and
 * intercept its buttons. The detail-panel Start-timer entry point is covered by
 * the first test, which never touches the break banner.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp, launchAppWithEnv } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function navigateToProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

// Start the timer on the first row (TEST-1) via its hover ▶ button.
async function startFirstRowTimer(page: Page) {
  const row = page.locator('[data-testid="task-row"]').first();
  await row.hover();
  await page.locator('[data-testid="row-start-timer"]').first().click();
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
}

test.describe('Task timer', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToProject(page);
  });

  test.afterEach(async () => {
    // A running timer triggers quit protection, which blocks app.close(). Stop
    // whichever phase is active; the fake worklog always succeeds, so the
    // success toast and a cleared timer are required, not hoped for — a stop
    // that silently failed would otherwise surface only as a close() timeout.
    const stop = page.locator('[data-testid="focus-stop-btn"], [data-testid="break-stop-btn"]').first();
    if (await stop.count()) {
      await stop.click();
      await expect(page.getByText(/Logged \d+ min/)).toBeVisible();
      await expect(page.locator('[data-testid="focus-overlay"], [data-testid="break-banner"]')).toHaveCount(0);
      // The renderer clears quit protection from an effect after the timer
      // clears. Clear it explicitly through the same IPC call, rather than
      // sleeping and hoping the effect has run, so close() is never blocked.
      await page.evaluate(() => window.vermilian.timerSetQuitProtection(false));
    }
    await app.close();
  });

  test('Start timer from the detail panel shows the focus overlay', async () => {
    await page.locator('[data-testid="task-row"]').first().click();
    await page.locator('[data-testid="detail-start-timer"]').click();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="focus-task-id"]')).toHaveText('TEST-1');
    await expect(page.locator('[data-testid="focus-time"]')).toHaveText(/^\d+:\d\d$/);
  });

  test('pause then resume toggles the PAUSED badge', async () => {
    await startFirstRowTimer(page);
    await expect(page.locator('[data-testid="focus-paused"]')).toBeHidden();

    await page.locator('[data-testid="focus-pause-btn"]').click();
    await expect(page.locator('[data-testid="focus-paused"]')).toBeVisible();

    await page.locator('[data-testid="focus-pause-btn"]').click();
    await expect(page.locator('[data-testid="focus-paused"]')).toBeHidden();
  });

  test('skip to break shows the break banner; skip break returns to work', async () => {
    await startFirstRowTimer(page);

    await page.locator('[data-testid="focus-skip-break-btn"]').click();
    await expect(page.locator('[data-testid="break-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeHidden();

    await page.locator('[data-testid="break-skip-btn"]').click();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="break-banner"]')).toBeHidden();
  });

  test('the running task row shows the timer badge', async () => {
    await startFirstRowTimer(page);
    // The first row (TEST-1) now shows the ▶ badge in place of the play button.
    const firstRow = page.locator('[data-testid="task-row"]').first();
    await expect(firstRow.locator('[data-testid="timer-badge"]')).toBeVisible();
    await expect(firstRow.locator('[data-testid="row-start-timer"]')).toHaveCount(0);
  });

  test('stop & log clears the timer and toasts the logged time', async () => {
    await startFirstRowTimer(page);
    await page.locator('[data-testid="focus-stop-btn"]').click();

    await expect(page.getByText(/Logged \d+ min to 'TEST-1'/)).toBeVisible();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeHidden();
  });
});

// Finding K2 (B9 heads-up): YouTrack refuses the worklog when time tracking is
// disabled on the project. The fake rejects the first post only, so this also
// shows that a later Stop & log succeeds once the refusal clears.
test.describe('Task timer — refused worklog', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv({ VERMILIAN_E2E_WORKLOG_REJECT: '1' });
    page = await app.firstWindow();
    await navigateToProject(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('a refused worklog is reported as a failure, not as logged, and the timer is kept', async () => {
    await startFirstRowTimer(page);
    await page.locator('[data-testid="focus-stop-btn"]').click();

    await expect(page.getByText(/Failed to log worklog: Time tracking is disabled/)).toBeVisible();
    await expect(page.getByText(/Logged \d+ min/)).toHaveCount(0);
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();

    // Stopping again succeeds once the refusal clears, and only then reports success.
    await page.locator('[data-testid="focus-stop-btn"]').click();
    await expect(page.getByText(/Logged \d+ min to 'TEST-1'/)).toBeVisible();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeHidden();
  });
});

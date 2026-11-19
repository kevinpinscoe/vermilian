/**
 * The OS notifications setting (VERM-71). The renderer's clock is Playwright's
 * fake clock, so a whole work block and break run out in moments, and the
 * browser's Notification is replaced with one that records each title.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchApp } from './helpers/launch';

const MINUTE = 60_000;
const BOTH = ['Pomodoro complete', 'Break complete'];

let app: ElectronApplication;
let page: Page;

async function openBoard() {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

async function recordNotifications() {
  await page.evaluate(() => {
    const sent: string[] = [];
    class RecordingNotification {
      static permission = 'granted';
      constructor(title: string) {
        sent.push(title);
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification, configurable: true, writable: true });
    Object.defineProperty(window, '__sentNotifications', { value: sent });
  });
}

function sentNotifications() {
  return page.evaluate(() => (window as unknown as { __sentNotifications: string[] }).__sentNotifications.slice());
}

async function setOsNotifications(on: boolean) {
  await page.locator('[data-testid="topbar-settings-btn"]').click();
  const checkbox = page.getByRole('checkbox', { name: 'OS notifications' });
  await expect(checkbox).toBeChecked({ checked: !on });
  // Vibe keeps the real input out of view, so Playwright cannot click it directly.
  await checkbox.evaluate((el: HTMLInputElement) => el.click());
  await expect(checkbox).toBeChecked({ checked: on });
  await page.locator('[data-testid="settings-save-btn"]').click();
  await openBoard();
}

// Starts a timer and runs out one work block and the break that follows it.
async function runBlockAndBreak() {
  const row = page.locator('[data-testid="task-row"]').first();
  await row.hover();
  await page.locator('[data-testid="row-start-timer"]').first().click();
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();

  await page.clock.fastForward(25 * MINUTE + 1000);
  await expect(page.locator('[data-testid="break-banner"]')).toBeVisible();

  await page.clock.fastForward(5 * MINUTE + 1000);
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
}

async function stopTimer() {
  await page.locator('[data-testid="focus-stop-btn"]').click();
  await expect(page.locator('[data-testid="focus-overlay"]')).toHaveCount(0);
  await page.evaluate(() => window.vermilian.timerSetQuitProtection(false));
}

test.beforeEach(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  // The fake clock must be in place before the app's code loads.
  await page.clock.install();
  await page.reload();
  await openBoard();
  await recordNotifications();
});

test.afterEach(async () => {
  await app.close();
});

test('with the setting on, the work-block and break notifications both fire', async () => {
  await runBlockAndBreak();
  await stopTimer();
  expect(await sentNotifications()).toEqual(BOTH);
});

test('with the setting off, neither notification fires', async () => {
  await setOsNotifications(false);
  await runBlockAndBreak();
  await stopTimer();
  expect(await sentNotifications()).toEqual([]);
});

test('turning the setting back on applies without restarting the app', async () => {
  await setOsNotifications(false);
  await runBlockAndBreak();
  await stopTimer();
  expect(await sentNotifications()).toEqual([]);

  await setOsNotifications(true);
  await runBlockAndBreak();
  await stopTimer();
  expect(await sentNotifications()).toEqual(BOTH);
});

/**
 * README screenshot generator (not an assertion test).
 *
 * Launches the packaged app against the in-memory fake YouTrack
 * (VERMILIAN_E2E=1 via launchApp) and captures the key views as PNGs for the
 * public README. Output goes to $SHOT_DIR (defaults to ./e2e/.shots, which is
 * gitignored — the generated images live in the public repo, not here).
 *
 * Run:
 *   pnpm package            # once, if out/ is stale
 *   SHOT_DIR=/abs/out/dir xvfb-run -a node_modules/.bin/playwright test e2e/screenshots.spec.ts
 */
import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '.shots');

async function openFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 20_000 });
  await page.locator('[data-testid="nav-project"]').filter({ hasText: 'Test Project' }).first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 20_000 });
  // Let the board settle (rows, chips, layout) before capturing.
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, name) });
}

test('capture README screenshots', async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const app: ElectronApplication = await launchApp();
  const page = await app.firstWindow();

  // 1) Board — light theme (hero shot).
  await openFirstProject(page);
  await expect(page.locator('.light-app-theme').first()).toBeVisible();
  await shot(page, 'board-light.png');

  // 2) Task detail panel (light).
  const panel = page.locator('[data-testid="task-detail-panel"]');
  await page.locator('[data-task-id="0-e1-1"] [data-testid="issue-id"]').click();
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'task-detail.png');

  // 2b) Pomodoro focus timer — start from the detail panel (default mode is
  // pomodoro). Scope the click to the panel; board rows also expose a
  // "Start timer" icon, which would make an unscoped match ambiguous.
  await panel.getByRole('button', { name: 'Start timer' }).click();
  await expect(page.getByRole('button', { name: 'Skip to break' })).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, 'timer-focus.png');
  // Stop & log exits focus mode cleanly (worklog goes to the in-memory fake).
  await page.getByRole('button', { name: 'Stop & log' }).click();
  await expect(page.getByRole('button', { name: 'Skip to break' })).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // 3) Settings / connection view (light).
  await page.getByLabel('Open Settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'settings.png');

  // 4) Board — dark theme. Toggle Dark, persist, return to the board.
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('.dark-app-theme').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  // Save may or may not auto-return to the board; ensure we land on it.
  const nav = page.locator('[data-testid="nav-project"]').filter({ hasText: 'Test Project' }).first();
  await nav.waitFor({ state: 'visible', timeout: 20_000 });
  await nav.click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 20_000 });
  await expect(page.locator('.dark-app-theme').first()).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, 'board-dark.png');

  await app.close();
});

/**
 * Quitting with unsaved changes (VERM-123, shared/quitGuard.ts).
 *
 *   - nothing unsaved: quitting is immediate and asks nothing;
 *   - an editor with unsubmitted changes (here Settings) asks first:
 *     Cancel keeps the app and the edit, Save and quit saves then quits,
 *     Quit without saving quits and the edit is gone;
 *   - closing the window asks the same way (Linux/Windows: a close is a quit);
 *   - a pending automatic write that cannot be saved asks instead of quitting.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

const LOGIN = 'your.login';

async function openSettings(page: Page) {
  await page.locator('[data-testid="topbar-settings-btn"]').click();
  await expect(page.getByPlaceholder(LOGIN)).toBeVisible();
}

// Not awaited past the call itself: when nothing stops the quit, the process
// exits before the evaluate can answer.
async function requestQuit(app: ElectronApplication) {
  void app.evaluate(({ app: electronApp }) => { setTimeout(() => electronApp.quit(), 0); }).catch(() => undefined);
}

async function closeWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
}

const dialog = (page: Page) => page.locator('[data-testid="unsaved-quit-dialog"]');

// Clicks a button that quits the app and waits for it to exit. The process can
// be gone before the click is acknowledged, so the click itself may reject;
// the exit is what the test checks.
async function clickAndExit(app: ElectronApplication, page: Page, testId: string) {
  const closed = app.waitForEvent('close');
  await page.locator(`[data-testid="${testId}"]`).click().catch(() => undefined);
  await closed;
}

test.describe('Quitting with unsaved changes (VERM-123)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  let exited: boolean;

  async function launch() {
    app = await launchAppWithUserDataDir(userDataDir);
    exited = false;
    app.on('close', () => { exited = true; });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  }

  test.beforeEach(async () => {
    userDataDir = freshUserDataDir();
    await launch();
  });

  test.afterEach(async () => {
    if (exited) return;
    // Whatever a test left open, leave without asking.
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  });

  test('with nothing unsaved, quitting asks nothing', async () => {
    const closed = app.waitForEvent('close');
    await requestQuit(app);
    await closed;
  });

  test('unsaved Settings: Cancel keeps the app and the edit', async () => {
    await openSettings(page);
    await page.getByPlaceholder(LOGIN).fill('typed-not-saved');
    await requestQuit(app);
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('[data-testid="unsaved-quit-message"]')).toHaveText('You have unsaved changes in Settings.');
    await page.locator('[data-testid="unsaved-quit-cancel"]').click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByPlaceholder(LOGIN)).toHaveValue('typed-not-saved');
    expect(exited).toBe(false);
  });

  test('unsaved Settings: Save and quit saves, then quits', async () => {
    await openSettings(page);
    await page.getByPlaceholder(LOGIN).fill('saved-on-quit');
    await requestQuit(app);
    await expect(dialog(page)).toBeVisible();
    await clickAndExit(app, page, 'unsaved-quit-save');

    await launch();
    await openSettings(page);
    await expect(page.getByPlaceholder(LOGIN)).toHaveValue('saved-on-quit');
  });

  test('unsaved Settings: Quit without saving quits and drops the edit', async () => {
    await openSettings(page);
    const before = await page.getByPlaceholder(LOGIN).inputValue();
    await page.getByPlaceholder(LOGIN).fill('dropped-on-quit');
    await requestQuit(app);
    await expect(dialog(page)).toBeVisible();
    await clickAndExit(app, page, 'unsaved-quit-discard');

    await launch();
    await openSettings(page);
    await expect(page.getByPlaceholder(LOGIN)).toHaveValue(before);
  });

  test('closing the window with unsaved Settings asks too', async () => {
    test.skip(process.platform === 'darwin', 'On macOS a window close is not a quit');
    await openSettings(page);
    await page.getByPlaceholder(LOGIN).fill('typed-not-saved');
    await closeWindow(app);
    await expect(dialog(page)).toBeVisible();
    await page.locator('[data-testid="unsaved-quit-cancel"]').click();
    await expect(dialog(page)).toBeHidden();
    expect(exited).toBe(false);
  });

  test('a pending write that cannot be saved asks instead of quitting', async () => {
    // Every _vermilian-config write fails from here on.
    await page.evaluate(() => window.vermilian.debugFailConfigWrites!(1_000));
    // A layout change: renaming a folder is a legacy-storage config write.
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    expect(config).not.toBeNull();
    const ws = config!.workspaces[0];
    const renamed = { ...config!, workspaces: [{ ...ws, name: `${ws.name} renamed` }, ...config!.workspaces.slice(1)] };
    await page.evaluate((c) => window.vermilian.saveWorkspaceConfig(c), renamed);

    await requestQuit(app);
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="unsaved-quit-message"]')).toContainText('could not be saved to YouTrack');
    expect(exited).toBe(false);

    await clickAndExit(app, page, 'unsaved-quit-discard');
  });
});

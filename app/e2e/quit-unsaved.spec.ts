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
import path from 'path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, serialiseNewWorkspaceDocument, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import { workspaceArticleTitle } from '../src/shared/workspaceArticle';

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

// Per-workspace storage, with the workspace articles kept in a store file so a
// relaunch reads what the first launch saved (VERMILIAN_E2E_WS_STORE_FILE).
test.describe('Save and quit from Add projects (VERM-123 review)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  let env: Record<string, string>;
  let exited: boolean;

  const doc: WorkspaceDocument = {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: 'ws-e2equit',
    name: 'Quit Space',
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [{ id: 'folder-quit', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
    boards: {},
    dismissals: {},
  };

  async function launch() {
    app = await launchAppWithUserDataDir(userDataDir, env);
    exited = false;
    app.on('close', () => { exited = true; });
    page = await app.firstWindow();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Quit Space', { timeout: 15_000 });
  }

  test.beforeEach(async () => {
    userDataDir = freshUserDataDir();
    env = {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_WS_ARTICLES: JSON.stringify([{ summary: workspaceArticleTitle(doc.workspaceId), content: serialiseNewWorkspaceDocument(doc) }]),
      VERMILIAN_E2E_WS_STORE_FILE: path.join(userDataDir, 'e2e-ws-store.json'),
    };
    await launch();
  });

  test.afterEach(async () => {
    if (exited) return;
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  });

  test('a refused save keeps the picker and its ticks; a retry saves them and quits', async () => {
    await page.locator('[data-testid="add-projects-btn"]').click();
    const tst2 = page.locator('[data-testid="add-projects-row"][data-project-key="TST2"] input');
    await tst2.check();

    await requestQuit(app);
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('[data-testid="unsaved-quit-message"]')).toContainText('Add projects to “Quit Space”');

    // The next workspace-article write is refused.
    await page.evaluate(() => window.vermilian.debugFailWorkspaceWrites!(1));
    await page.locator('[data-testid="unsaved-quit-save"]').click();
    await expect(page.locator('[data-testid="unsaved-quit-error"]')).toContainText('Add projects to “Quit Space” could not be saved');
    expect(exited).toBe(false);
    // The picker is still open with the tick.
    await expect(page.locator('[data-testid="add-projects-save-error"]')).toBeVisible();
    await expect(tst2).toBeChecked();

    // The retry saves, and only then quits.
    await clickAndExit(app, page, 'unsaved-quit-save');

    await launch();
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    expect(config!.workspaces[0].folders.flatMap((f) => f.projectIds)).toEqual(expect.arrayContaining(['0-e1', '0-e2']));
  });
});

// macOS keeps the app running when its last window closes. The suite runs on
// Linux, so VERMILIAN_E2E_WINDOW_CLOSE=keep-running gives the app that
// behaviour (main/windowClose.ts).
test.describe('Closing the window without quitting, as on macOS (VERM-123 review)', () => {
  let app: ElectronApplication;
  let page: Page;
  let exited: boolean;

  const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

  // Replaces the native dialog a windowless quit uses; records each call.
  async function stubNativeDialog(response: number) {
    await app.evaluate(({ dialog }, r) => {
      const g = globalThis as unknown as { __dialogCalls?: unknown[] };
      g.__dialogCalls = g.__dialogCalls ?? [];
      dialog.showMessageBox = (async (...args: unknown[]) => {
        g.__dialogCalls!.push(args);
        return { response: r, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, response);
  }
  const nativeDialogCalls = () =>
    app.evaluate(() => JSON.stringify((globalThis as unknown as { __dialogCalls?: unknown[] }).__dialogCalls ?? []));

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WINDOW_CLOSE: 'keep-running' });
    exited = false;
    app.on('close', () => { exited = true; });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });

  test.afterEach(async () => {
    if (exited) return;
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  });

  test('a dirty editor asks about closing the window, and the answer never quits the app', async () => {
    await openSettings(page);
    await page.getByPlaceholder(LOGIN).fill('typed-not-saved');

    await closeWindow(app);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByText('Save changes before closing?')).toBeVisible();
    await expect(page.locator('[data-testid="unsaved-quit-discard"]')).toHaveText('Close without saving');
    await expect(page.locator('[data-testid="unsaved-quit-save"]')).toHaveText('Save and close');
    await page.locator('[data-testid="unsaved-quit-cancel"]').click();
    await expect(dialog(page)).toBeHidden();
    expect(await windowCount()).toBe(1);

    await closeWindow(app);
    await expect(dialog(page)).toBeVisible();
    await page.locator('[data-testid="unsaved-quit-discard"]').click().catch(() => undefined);
    await expect.poll(windowCount).toBe(0);
    // The window closed; the app did not quit.
    await new Promise((r) => setTimeout(r, 500)); // the page is gone with its window
    expect(exited).toBe(false);

    // With nothing left unsaved, quitting now is immediate.
    const closed = app.waitForEvent('close');
    await requestQuit(app);
    await closed;
  });

  test('a write that cannot be saved asks at the window close, and again when quitting with no window', async () => {
    await page.evaluate(() => window.vermilian.debugFailConfigWrites!(1_000));
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const ws = config!.workspaces[0];
    await page.evaluate(
      (c) => window.vermilian.saveWorkspaceConfig(c),
      { ...config!, workspaces: [{ ...ws, name: `${ws.name} renamed` }, ...config!.workspaces.slice(1)] },
    );

    // Closing the window flushes first, while it can still ask.
    await closeWindow(app);
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="unsaved-quit-message"]')).toContainText('could not be saved to YouTrack');
    await page.locator('[data-testid="unsaved-quit-discard"]').click().catch(() => undefined);
    await expect.poll(windowCount).toBe(0);
    expect(exited).toBe(false);

    // Quitting with no window: the failed flush asks through a native dialog.
    // Cancel keeps the app running.
    await stubNativeDialog(2);
    await requestQuit(app);
    await expect.poll(nativeDialogCalls, { timeout: 15_000 }).toContain('could not be saved to YouTrack');
    await new Promise((r) => setTimeout(r, 500));
    expect(exited).toBe(false);

    // "Quit without saving" quits.
    await stubNativeDialog(1);
    const closed = app.waitForEvent('close');
    await requestQuit(app);
    await closed;
  });
});

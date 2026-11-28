import { BrowserWindow, app, dialog, Menu } from 'electron';
import path from 'node:path';
import {
  clearUnsavedState, getUnsavedState, isQuitProtected, loadYtToken, sendQuitRequested, sendUnsavedQuitRequested, setWindowChoiceHandler, takeQuitChoice,
} from './ipc';
import { hasUnsaved, nextQuitStep, type QuitChoice } from '../shared/quitGuard';
import { windowCloseQuits } from './windowClose';
import * as articleConfig from './services/articleConfig';
import { readConfig } from './services/config';
import { workspaceStorageMode } from './services/activeWorkspace';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(process.resourcesPath, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // DevTools toggle: F12 or Cmd+Option+I (macOS) / Ctrl+Shift+I (other)
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    const devToolsShortcut =
      input.key === 'F12' ||
      (input.key === 'i' && input.alt && (process.platform === 'darwin' ? input.meta : input.control));
    if (devToolsShortcut) win.webContents.toggleDevTools();
  });

  // Right-click context menu with standard edit actions throughout the app
  win.webContents.on('context-menu', (_e, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'cut',       enabled: params.editFlags.canCut },
      { role: 'copy',      enabled: params.editFlags.canCopy },
      { role: 'paste',     enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    ]);
    menu.popup();
  });

  // On Windows and Linux every close is a quit, so it goes through the
  // before-quit pipeline while the window is still here to ask in. On macOS
  // the app keeps running without its window, so a close only ever closes the
  // window: it asks about what the window would lose and flushes pending
  // writes first, and an answer never quits the app (VERM-123 review).
  win.on('close', (e) => {
    if (finalPass || closeApproved.has(win)) return;
    e.preventDefault();
    if (windowCloseQuits()) {
      app.quit();
      return;
    }
    void closeWindowSteps(win);
  });
  win.on('closed', () => {
    closeApproved.delete(win);
    // Its editors went with it; nothing it reported is unsaved any more.
    clearUnsavedState();
  });

  return win;
}

// The quit pipeline (Cmd+Q / Ctrl+Q / menu / window close), registered once.
// Each step is shared/quitGuard.ts nextQuitStep: ask about a running timer,
// then about unsaved changes (VERM-123), then flush the pending debounced
// _vermilian-config write. A flush that fails asks again instead of quitting.
let beforeQuitRegistered = false;
let flushing = false;
// Set once every step has passed; lets the re-triggered quit and the window
// closes it causes through.
let finalPass = false;

const SAVE_FAILED_MESSAGE =
  'Your workspace layout and board settings could not be saved to YouTrack. ' +
  'Quitting now loses those changes.';

async function flushPendingWrites(): Promise<{ ok: true } | { ok: false; message: string }> {
  // Legacy storage only: under per-workspace storage nothing is pending for
  // _vermilian-config, and its guard would refuse the write anyway (VERM-53).
  if (workspaceStorageMode() !== 'legacy' || !articleConfig.hasUnsavedChanges()) return { ok: true };
  try {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) await articleConfig.flush(cfg.youtrackUrl, token);
  } catch { /* reported below: the edits are still unsaved */ }
  return articleConfig.hasUnsavedChanges() ? { ok: false, message: SAVE_FAILED_MESSAGE } : { ok: true };
}

function finishQuit(): void {
  finalPass = true;
  app.quit();
}

// ─── Closing a window without quitting (macOS) ───────────────────────────────

// Windows allowed to close by the steps below; checked by their close handler.
const closeApproved = new Set<BrowserWindow>();

function closeWindowNow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  closeApproved.add(win);
  win.close();
}

async function closeWindowSteps(win: BrowserWindow): Promise<void> {
  // The timer lives in the window: ask about it as before. Its "Stop timer &
  // quit" is a quit, which is what it says.
  if (isQuitProtected()) {
    sendQuitRequested();
    return;
  }
  if (hasUnsaved(getUnsavedState())) {
    sendUnsavedQuitRequested({ kind: 'unsaved', scope: 'window', state: getUnsavedState() });
    return;
  }
  await flushThenCloseWindow(win);
}

// Pending automatic writes are flushed while the window is still here to ask
// in; after it closes there would be no one to tell if they failed.
async function flushThenCloseWindow(win: BrowserWindow): Promise<void> {
  const r = await flushPendingWrites();
  if (!r.ok) {
    sendUnsavedQuitRequested({ kind: 'save-failed', scope: 'window', message: r.message });
    return;
  }
  closeWindowNow(win);
}

// The answer to a window-close prompt (ipc.ts quitProceed).
function onWindowChoice(choice: QuitChoice): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (choice === 'discard') closeWindowNow(win);
  else void flushThenCloseWindow(win);
}

// A quit with no window left to ask in, and a flush that failed: a native
// dialog asks instead of the app exiting silently (VERM-123 review).
async function askWithoutWindow(message: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Save changes before quitting?',
    detail: message,
    buttons: ['Try again', 'Quit without saving', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 0) app.quit();
  else if (response === 1) finishQuit();
}

export function registerQuitProtection(): void {
  if (beforeQuitRegistered) return;
  beforeQuitRegistered = true;
  setWindowChoiceHandler(onWindowChoice);

  app.on('before-quit', (e) => {
    if (finalPass) return;
    e.preventDefault();
    if (flushing) return;
    const timerProtected = isQuitProtected();
    const step = nextQuitStep({
      timerProtected,
      choice: timerProtected ? null : takeQuitChoice(),
      state: getUnsavedState(),
    });
    if (step === 'ask-timer') {
      sendQuitRequested();
      return;
    }
    if (step === 'ask-unsaved') {
      if (BrowserWindow.getAllWindows().length > 0) {
        sendUnsavedQuitRequested({ kind: 'unsaved', scope: 'quit', state: getUnsavedState() });
      } else {
        // Nothing left that could hold an unsaved editor: carry on.
        flushStep();
      }
      return;
    }
    if (step === 'quit') {
      finishQuit();
      return;
    }
    flushStep();
  });
}

// The last step: flush pending automatic writes, then quit. A failure asks in
// the window, or with a native dialog when no window is left.
function flushStep(): void {
  flushing = true;
  void flushPendingWrites().then((r) => {
    flushing = false;
    if (r.ok) {
      finishQuit();
    } else if (BrowserWindow.getAllWindows().length > 0) {
      sendUnsavedQuitRequested({ kind: 'save-failed', scope: 'quit', message: r.message });
    } else {
      void askWithoutWindow(r.message);
    }
  });
}

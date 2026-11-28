import { BrowserWindow, app, Menu } from 'electron';
import path from 'node:path';
import { getUnsavedState, isQuitProtected, loadYtToken, sendQuitRequested, sendUnsavedQuitRequested, takeQuitChoice } from './ipc';
import { hasUnsaved, nextQuitStep } from '../shared/quitGuard';
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

  // Every close is a quit (except on macOS, below), so it goes through the
  // before-quit pipeline while the window is still here to ask in (VERM-123).
  win.on('close', (e) => {
    if (finalPass) return;
    if (process.platform !== 'darwin') {
      e.preventDefault();
      app.quit();
      return;
    }
    // macOS keeps the app running when its window closes: ask only about what
    // would be lost with the window. The timer is unaffected by a close.
    if (isQuitProtected()) {
      e.preventDefault();
      sendQuitRequested();
    } else if (hasUnsaved(getUnsavedState())) {
      e.preventDefault();
      sendUnsavedQuitRequested({ kind: 'unsaved', state: getUnsavedState() });
    }
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

export function registerQuitProtection(): void {
  if (beforeQuitRegistered) return;
  beforeQuitRegistered = true;

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
      sendUnsavedQuitRequested({ kind: 'unsaved', state: getUnsavedState() });
      return;
    }
    if (step === 'quit') {
      finishQuit();
      return;
    }
    flushing = true;
    void flushPendingWrites().then((r) => {
      flushing = false;
      // With no window left (macOS) there is no one to ask: quit as before.
      if (!r.ok && BrowserWindow.getAllWindows().length > 0) {
        sendUnsavedQuitRequested({ kind: 'save-failed', message: r.message });
        return;
      }
      finishQuit();
    });
  });
}

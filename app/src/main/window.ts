import { BrowserWindow, app, Menu } from 'electron';
import path from 'node:path';
import { isQuitProtected, sendQuitRequested } from './ipc';
import * as articleConfig from './services/articleConfig';
import { readConfig, writeConfig as _writeConfig } from './services/config';
import { loadSecretWithSources, FILES } from './services/credentials';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  // Intercept window close button when timer is running.
  win.on('close', (e) => {
    if (isQuitProtected()) {
      e.preventDefault();
      sendQuitRequested();
    }
  });

  return win;
}

// Intercept app quit (Cmd+Q / Ctrl+Q / menu) when timer is running.
// This is registered once globally so it doesn't accumulate.
let beforeQuitRegistered = false;
let flushing = false;

export function registerQuitProtection(): void {
  if (beforeQuitRegistered) return;
  beforeQuitRegistered = true;

  app.on('before-quit', async (e) => {
    if (isQuitProtected()) {
      e.preventDefault();
      sendQuitRequested();
      return;
    }
    // Flush any pending debounced article saves before the process exits.
    if (!flushing) {
      flushing = true;
      e.preventDefault();
      try {
        const cfg = await readConfig();
        const token = await loadSecretWithSources(
          FILES.youtrackToken, cfg.youtrackTokenCommand, cfg.youtrackTokenFile,
        );
        if (cfg.youtrackUrl && token) {
          await articleConfig.flush(cfg.youtrackUrl, token);
        }
      } catch { /* best effort */ }
      app.quit(); // re-trigger; flushing=true prevents infinite loop
    }
  });
}

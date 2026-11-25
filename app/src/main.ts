// e2e only, and first: wraps process launches before any module captures them (VERM-106).
import './main/e2eProcessRecorder';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { createWindow, registerQuitProtection } from './main/window';
import { registerIpc } from './main/ipc';
import { encryptPlaintextSecrets } from './main/services/credentials';
import { runSqliteSelfTest } from './main/services/sqliteSelfTest';

// CI-only SQLite compatibility check (ADR-0011): when this variable names an
// absolute file path, run the self-test in this packaged main process, write
// its JSON result there, and exit without opening a window. A file is used
// rather than stdout because Windows GUI builds do not reliably expose stdout.
const sqliteSelfTestOut = process.env.VERMILIAN_SQLITE_SELFTEST_OUT;

if (started) {
  app.quit();
} else if (sqliteSelfTestOut && isAbsolute(sqliteSelfTestOut)) {
  runSqliteSelfTest().then(
    (result) => {
      writeFileSync(sqliteSelfTestOut, JSON.stringify(result, null, 2));
      app.exit(result.ok ? 0 : 1);
    },
    (err: unknown) => {
      writeFileSync(sqliteSelfTestOut, JSON.stringify({ ok: false, error: String(err) }));
      app.exit(2);
    },
  );
} else {
  app.on('ready', () => {
    registerIpc();
    // Plain-text credentials left by versions before VERM-57 are encrypted
    // as soon as safeStorage can; Settings reports any that remain.
    if (process.env.VERMILIAN_E2E !== '1') void encryptPlaintextSecrets().catch(() => {});
    registerQuitProtection();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

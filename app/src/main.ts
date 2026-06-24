import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { createWindow, registerQuitProtection } from './main/window';
import { registerIpc } from './main/ipc';

if (started) {
  app.quit();
}

app.on('ready', () => {
  registerIpc();
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

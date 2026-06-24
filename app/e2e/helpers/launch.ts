import { _electron as electron, ElectronApplication } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Uses the packaged binary built by `pnpm package` (electron-forge package).
// Output lands at out/Vermilian-linux-x64/Vermilian on Linux.
// Run `pnpm package` once before running tests, or use `pnpm test:e2e` which
// packages automatically when out/ does not exist.
//
// VERMILIAN_E2E=1 switches the main process to an in-memory fake YouTrack
// (deterministic fixtures, no network, no production mutation — see
// src/main/api/fakeYouTrack.ts). Each launch also gets a fresh --user-data-dir
// so config/credential state never leaks between tests or touches the real
// user profile.
const ELECTRON_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-gpu-compositing',
  '--in-process-gpu',
];

const EXECUTABLE = path.join(__dirname, '../../out/Vermilian-linux-x64/Vermilian');

function freshUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-'));
}

export async function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${freshUserDataDir()}`, ...ELECTRON_ARGS],
    env: { ...process.env, VERMILIAN_E2E: '1' },
  });
}

// Launches with e2e credential mocks but without the pre-seeded youtrackUrl,
// so the app starts in unconfigured (first-run) state. Use this to test the
// settings → save → navigate-to-board flow.
export async function launchAppUnconfigured(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${freshUserDataDir()}`, ...ELECTRON_ARGS],
    env: { ...process.env, VERMILIAN_E2E: '1', VERMILIAN_E2E_UNCONFIGURED: '1' },
  });
}

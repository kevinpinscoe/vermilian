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

export function freshUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-'));
}

export async function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${freshUserDataDir()}`, ...ELECTRON_ARGS],
    env: { ...process.env, VERMILIAN_E2E: '1' },
  });
}

// Launches against a caller-provided --user-data-dir instead of a fresh one —
// lets a test relaunch the same profile (e.g. after editing a config file on
// disk between launches) rather than always getting a clean slate. `extraEnv`
// layers on top of the base E2E env (e.g. VERMILIAN_E2E_ARTICLE_CONTENT to
// seed the fake _vermilian-config Article with a specific starting body).
export async function launchAppWithUserDataDir(
  userDataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${userDataDir}`, ...ELECTRON_ARGS],
    env: { ...process.env, VERMILIAN_E2E: '1', ...extraEnv },
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

// Launches fully configured, but with the fake YouTrack rejecting every
// getProjects call with a 401 — the state a rebuilt/re-tokened YouTrack leaves
// the app in. The token file still exists, so the app considers itself
// connected and routes to the board rather than to first-run Settings.
export async function launchAppWithRevokedToken(): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: EXECUTABLE,
    args: [`--user-data-dir=${freshUserDataDir()}`, ...ELECTRON_ARGS],
    env: { ...process.env, VERMILIAN_E2E: '1', VERMILIAN_E2E_YT_401: '1' },
  });
}

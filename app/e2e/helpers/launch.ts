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
export async function launchApp(): Promise<ElectronApplication> {
  const executablePath = path.join(
    __dirname,
    '../../out/Vermilian-linux-x64/Vermilian',
  );
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-'));
  return electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${userDataDir}`,
      // Allow running under a headless X server (xvfb) without a usable GPU.
      '--no-sandbox',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-gpu-compositing',
      '--in-process-gpu',
    ],
    env: { ...process.env, VERMILIAN_E2E: '1' },
  });
}

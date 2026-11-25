/**
 * A release package has no e2e process recorder (VERM-106), even when launched
 * with VERMILIAN_E2E=1: the recorder, its IPC channels and its preload debug
 * methods are compiled in only when the package is built with
 * VERMILIAN_E2E_BUILD=1.
 *
 * Runs only through `pnpm test:release-isolation`, which packages a release
 * build first (e2e/package-e2e-build.sh --release); the ordinary suite skips
 * it, since it runs against the e2e build. The harness is shown to be active
 * by the e2e hook that is not build-gated (debugGetPostedComments).
 */

import { test, expect } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

test.skip(process.env.VERMILIAN_RELEASE_ISOLATION_CHECK !== '1', 'run with pnpm test:release-isolation, against a release package');

test('a release package launched with VERMILIAN_E2E=1 exposes no process recorder and registers none of its channels', async () => {
  const app = await launchAppWithUserDataDir(freshUserDataDir(), {});
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const exposed = await page.evaluate(() => ({
      launches: typeof window.vermilian.debugGetProcessLaunches,
      reads: typeof window.vermilian.debugGetRequiredTokenReads,
      posted: typeof window.vermilian.debugGetPostedComments,
    }));
    expect(exposed).toEqual({ launches: 'undefined', reads: 'undefined', posted: 'function' });
    const channels = await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers;
      if (!handlers) throw new Error('ipcMain._invokeHandlers is not available in this Electron');
      return {
        launches: handlers.has('e2e:getProcessLaunches'),
        reads: handlers.has('e2e:getRequiredTokenReads'),
        posted: handlers.has('e2e:getPostedComments'),
        e2e: process.env.VERMILIAN_E2E,
      };
    });
    expect(channels).toEqual({ launches: false, reads: false, posted: true, e2e: '1' });
  } finally {
    await app.close();
  }
});

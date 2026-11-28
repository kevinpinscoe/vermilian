/**
 * VERM-123: the workspace a machine last chose is the one it starts on, even
 * when the workspace list is briefly incomplete at start-up.
 *
 * On the FLDW, the first launch of 1.8.0 opened on the wrong workspace: the
 * stored choice was missing from the start-up answer, the main process fell
 * back (to a frozen legacy hint), the renderer latched that fallback, and the
 * next click made it permanent. Here the fake YouTrack leaves the stored
 * workspace out of its article listing for a few seconds, and a renderer
 * reload stands in for the restart (the main process, its stored choice and
 * the fake's articles all survive it; a full relaunch would lose the fake's
 * in-memory per-workspace articles).
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const switcher = (page: Page) => page.locator('[data-testid="workspace-switcher"]');

function storedActiveId(userDataDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'active-workspace.json'), 'utf8');
    return (JSON.parse(raw) as { activeWorkspaceId: string }).activeWorkspaceId;
  } catch {
    return '';
  }
}

function wsDoc(workspaceId: string, name: string, order: number): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name,
    order,
    backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [{ id: `folder-${workspaceId}`, name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
    boards: {},
    dismissals: {},
  };
}

test.describe('Restoring the last workspace (VERM-123)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const d of [wsDoc('ws-e2efirst', 'First Space', 0), wsDoc('ws-e2ebudget', 'Budget Space', 1)]) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(switcher(page)).toContainText('First Space', { timeout: 15_000 });

    await switcher(page).click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Budget Space' }).click();
    await expect(switcher(page)).toContainText('Budget Space');
    await expect.poll(() => storedActiveId(userDataDir)).toBe('ws-e2ebudget');
  });

  test.afterEach(async () => { await app.close(); });

  test('a restart that briefly cannot see the stored workspace still opens on it', async () => {
    await page.evaluate(() => window.vermilian.debugHideWorkspaceFromListing!('ws-e2ebudget', 3_000));
    await page.reload();

    // The fallback may show first; the stored choice must win once it is listed
    // again, without a click or a window refocus.
    await expect(switcher(page)).toContainText('Budget Space', { timeout: 15_000 });
    const ctx = await page.evaluate(() => window.vermilian.getActiveWorkspace());
    expect(ctx.workspaceId).toBe('ws-e2ebudget');
    expect(ctx.tentative).toBe(false);
    // The fallback was never written over this machine's choice.
    expect(storedActiveId(userDataDir)).toBe('ws-e2ebudget');
  });

  test('while the stored workspace is missing, the answer is tentative and not persisted', async () => {
    await page.evaluate(() => window.vermilian.debugHideWorkspaceFromListing!('ws-e2ebudget', 60_000));
    const ctx = await page.evaluate(() => window.vermilian.getActiveWorkspace());
    expect(ctx.workspaceId).toBe('ws-e2efirst');
    expect(ctx.tentative).toBe(true);
    expect(storedActiveId(userDataDir)).toBe('ws-e2ebudget');
    await page.evaluate(() => window.vermilian.debugHideWorkspaceFromListing!('ws-e2ebudget', 0));
  });
});

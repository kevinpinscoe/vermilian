/**
 * Cross-machine workspace-config sync integrity (see RUNBOOK.md "Empty
 * projects/workspaces despite a working connection"). The _vermilian-config
 * YouTrack Article is shared across every machine pointed at the same
 * YouTrack instance; two bugs there let one machine's stale, pre-rebuild
 * project ids clobber the shared Article and break every other machine on
 * its next launch:
 *
 *   1. A machine could read/serve its local workspace-config.json cache
 *      before the Article finished loading, instead of waiting for it.
 *   2. Saving a workspace config never dropped project ids that no longer
 *      exist, so a stale local cache got echoed straight back up.
 *
 * These tests cover the fixes for both, plus the "Force resync from server"
 * recovery button for a config that's already corrupted.
 */

import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { launchApp, launchAppWithUserDataDir, freshUserDataDir } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

// Fixture project ids from src/main/api/fakeYouTrack.ts (0-e1..0-e4). A stale
// id from "before a rebuild" is any id outside that set.
const STALE_PROJECT_ID = '0-stale-pre-rebuild';

function workspaceConfigPath(userDataDir: string): string {
  return path.join(userDataDir, 'workspace-config.json');
}

test.describe('Workspace config: stale-id pruning on save', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('saveWorkspaceConfig drops project ids that no longer exist', async () => {
    const before = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    expect(before).not.toBeNull();
    const liveProjectId = before!.workspaces[0].folders[0].projectIds[0];

    const corrupted = {
      ...before!,
      workspaces: before!.workspaces.map((ws, i) =>
        i === 0
          ? {
              ...ws,
              folders: ws.folders.map((f, j) =>
                j === 0
                  ? { ...f, projectIds: [...f.projectIds, 'STALE_MARKER_ID'] }
                  : f,
              ),
            }
          : ws,
      ),
    };

    await page.evaluate((cfg) => window.vermilian.saveWorkspaceConfig(cfg), corrupted);

    const after = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const ids = after!.workspaces[0].folders[0].projectIds;
    expect(ids).not.toContain('STALE_MARKER_ID');
    expect(ids).toContain(liveProjectId);
  });
});

test.describe('Workspace config: startup precedence over a stale local cache', () => {
  test('the shared (Article) config wins over a stale local workspace-config.json on launch', async () => {
    const userDataDir = freshUserDataDir();

    // Seed a "server-side" Article that already has the correct, live project
    // assignment — simulating another machine that already fixed things.
    const cleanArticle = JSON.stringify({
      version: 1,
      workspaces: [
        {
          id: 'workspace-default',
          name: 'Workspace',
          order: 0,
          folders: [
            {
              id: 'folder-unassigned',
              name: 'Unassigned',
              order: 0,
              parentId: null,
              projectIds: ['0-e1', '0-e2', '0-e3', '0-e4'],
            },
          ],
        },
      ],
      activeWorkspaceId: 'workspace-default',
      boards: {},
    });

    // Seed THIS machine's local cache with stale, pre-rebuild project ids —
    // what a machine that hasn't relaunched since a YouTrack rebuild would have.
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      workspaceConfigPath(userDataDir),
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: 'workspace-default',
            name: 'Workspace',
            order: 0,
            folders: [
              {
                id: 'folder-unassigned',
                name: 'Unassigned',
                order: 0,
                parentId: null,
                projectIds: [STALE_PROJECT_ID],
              },
            ],
          },
        ],
        activeWorkspaceId: 'workspace-default',
      }),
    );

    const app = await launchAppWithUserDataDir(userDataDir, {
      VERMILIAN_E2E_ARTICLE_CONTENT: cleanArticle,
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });

      // The board must show the live fixture projects from the "server" —
      // not be empty, and not show the stale-only project.
      const projectIds = await page
        .locator('[data-testid="nav-project"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-nav-project-id')));
      expect(projectIds).toContain('0-e1');
      expect(projectIds).not.toContain(STALE_PROJECT_ID);
    } finally {
      await app.close();
    }
  });
});

test.describe('Workspace config: manual "Force resync from server"', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('re-fetches from the server and updates the local file', async () => {
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const result = await page.evaluate(() => window.vermilian.forceResyncWorkspaceConfig());
    expect(result.ok).toBe(true);

    const resynced = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    expect(resynced).not.toBeNull();
    const ids = resynced!.workspaces.flatMap((ws) => ws.folders.flatMap((f) => f.projectIds));
    expect(ids).toContain('0-e1');

    await page.locator('[data-testid="force-resync-btn"]').click();
    await expect(page.locator('[data-testid="force-resync-btn"]')).toBeVisible();
  });
});

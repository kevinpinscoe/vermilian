/**
 * One active workspace per machine (VERM-46, ADR-0011 §2), against the fake
 * YouTrack.
 *
 * Legacy storage (the default — _vermilian-config stays authoritative):
 *   - switching changes the board, and the choice is stored locally in
 *     userData/active-workspace.json, never in the shared article;
 *   - a running timer asks first: Cancel keeps the workspace and the timer,
 *     Stop timer logs the time and then switches.
 *
 * Per-workspace storage (VERMILIAN_E2E_WORKSPACE_STORAGE=per-workspace, an
 * e2e-only stand-in for the activation gate VERM-53 will own): switching
 * changes the backend context — a YouTrack workspace shows its board, a Jira
 * workspace says plainly that its board is not available yet.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const switcher = (page: Page) => page.locator('[data-testid="workspace-switcher"]');

async function waitForNav(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
}

async function createWorkspace(page: Page, name: string) {
  await switcher(page).click();
  await page.locator('[data-testid="new-workspace-btn"]').click();
  await page.locator('[data-testid="new-workspace-input"]').fill(name);
  await page.locator('[data-testid="new-workspace-submit"]').click();
  await expect(switcher(page)).toContainText(name);
}

async function chooseWorkspace(page: Page, name: string) {
  await switcher(page).click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
}

function storedActiveId(userDataDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'active-workspace.json'), 'utf8');
    return (JSON.parse(raw) as { activeWorkspaceId: string }).activeWorkspaceId;
  } catch {
    return '';
  }
}

test.describe('Workspace switching — legacy storage', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;

  test.beforeEach(async () => {
    userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir);
    page = await app.firstWindow();
    await waitForNav(page);
  });

  test.afterEach(async () => {
    // A running timer blocks close() through quit protection.
    await page.evaluate(() => window.vermilian.timerSetQuitProtection(false));
    await app.close();
  });

  test('switching changes the board; the choice is local, never in the shared article', async () => {
    // The default workspace holds every project, so its board lists tasks.
    await expect(page.locator('[data-testid="workspace-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="workspace-backend"]')).toHaveText('YouTrack · e2e.local');

    await createWorkspace(page, 'QA Space');
    // The new workspace has no projects: no board.
    await expect(page.locator('[data-testid="workspace-board"]')).toHaveCount(0);
    await expect.poll(() => storedActiveId(userDataDir)).toMatch(/^workspace-\d+$/);
    const qaId = storedActiveId(userDataDir);

    await chooseWorkspace(page, 'Workspace');
    await expect(switcher(page)).toContainText('Workspace');
    await expect(page.locator('[data-testid="workspace-board"]')).toBeVisible();
    await expect.poll(() => storedActiveId(userDataDir)).toBe('workspace-default');

    // The shared article records the new workspace but not this machine's choice.
    await expect
      .poll(async () => {
        const sources = await page.evaluate(() => window.vermilian.debugGetMigrationSources!());
        return sources.find((s) => s.id === 'e2e-article')?.content ?? '';
      }, { timeout: 10_000 })
      .toContain('QA Space');
    const sources = await page.evaluate(() => window.vermilian.debugGetMigrationSources!());
    const shared = JSON.parse(sources.find((s) => s.id === 'e2e-article')!.content) as { activeWorkspaceId?: string };
    expect(shared.activeWorkspaceId).not.toBe(qaId);
    expect(shared.activeWorkspaceId).not.toBe('workspace-default');

    // A relaunch on the same machine comes back to the local choice.
    await chooseWorkspace(page, 'QA Space');
    await expect.poll(() => storedActiveId(userDataDir)).toBe(qaId);
    await app.close();
    app = await launchAppWithUserDataDir(userDataDir);
    page = await app.firstWindow();
    await expect(switcher(page)).toContainText('QA Space', { timeout: 15_000 });
  });

  async function startTimerThenBreak() {
    await page.locator('[data-testid="nav-project"]').first().click();
    await page.waitForSelector('[data-testid="task-row"]', { timeout: 15_000 });
    const row = page.locator('[data-testid="task-row"]').first();
    await row.hover();
    await page.locator('[data-testid="row-start-timer"]').first().click();
    await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
    // The focus overlay covers the rail during work; a break uncovers it.
    await page.locator('[data-testid="focus-skip-break-btn"]').click();
    await expect(page.locator('[data-testid="break-banner"]')).toBeVisible();
  }

  test('a running timer: Cancel keeps the workspace and the timer', async () => {
    await createWorkspace(page, 'Other');
    await chooseWorkspace(page, 'Workspace');
    await expect(switcher(page)).toContainText('Workspace');
    await startTimerThenBreak();

    await chooseWorkspace(page, 'Other');
    await expect(page.locator('[data-testid="workspace-switch-dialog"]')).toBeVisible();
    await page.locator('[data-testid="workspace-switch-cancel"]').click();

    await expect(page.locator('[data-testid="workspace-switch-dialog"]')).toHaveCount(0);
    await expect(switcher(page)).not.toContainText('Other');
    await expect(page.locator('[data-testid="break-banner"]')).toBeVisible();
    await expect(page.getByText(/Logged \d+ min/)).toHaveCount(0);
    expect(storedActiveId(userDataDir)).toBe('workspace-default');

    await page.locator('[data-testid="break-stop-btn"]').click();
    await expect(page.getByText(/Logged \d+ min/)).toBeVisible();
  });

  test('a running timer: Stop timer logs the time, then switches', async () => {
    await createWorkspace(page, 'Other');
    await chooseWorkspace(page, 'Workspace');
    await expect(switcher(page)).toContainText('Workspace');
    await startTimerThenBreak();

    await chooseWorkspace(page, 'Other');
    await page.locator('[data-testid="workspace-switch-stop"]').click();

    await expect(page.getByText(/Logged \d+ min to 'TEST-1'/)).toBeVisible();
    await expect(page.locator('[data-testid="break-banner"]')).toHaveCount(0);
    await expect(switcher(page)).toContainText('Other');
    await expect.poll(() => storedActiveId(userDataDir)).toMatch(/^workspace-\d+$/);
  });
});

// Fictional values only (ADR-0011 §10).
function wsDoc(overrides: Partial<WorkspaceDocument> & Pick<WorkspaceDocument, 'workspaceId' | 'name' | 'order' | 'backend' | 'folders'>): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    ai: { credentialRef: null },
    boards: {},
    dismissals: {},
    ...overrides,
  };
}

test.describe('Workspace switching — per-workspace storage (e2e gate)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const docs = [
      wsDoc({
        workspaceId: 'ws-e2eyt1',
        name: 'Workspace A',
        order: 0,
        backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
        folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
      }),
      wsDoc({
        workspaceId: 'ws-e2ejr1',
        name: 'Workspace B',
        order: 1,
        backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
        folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
      }),
    ];
    for (const d of docs) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
  });

  test.afterEach(async () => { await app.close(); });

  test('switching changes the backend context and the board', async () => {
    await expect(switcher(page)).toContainText('Workspace A', { timeout: 15_000 });
    const backend = page.locator('[data-testid="workspace-backend"]');
    await expect(backend).toHaveText('YouTrack · e2e.local');
    await expect(page.locator('[data-testid="workspace-board"]')).toBeVisible();

    await chooseWorkspace(page, 'Workspace B');
    await expect(backend).toHaveText('Jira · example.atlassian.net');
    await expect(backend).toHaveAttribute('data-backend-kind', 'jira');
    await expect(page.locator('[data-testid="workspace-board-unavailable"]')).toContainText(
      'Jira boards are not available',
    );
    await expect(page.locator('[data-testid="workspace-board"]')).toHaveCount(0);

    await chooseWorkspace(page, 'Workspace A');
    await expect(backend).toHaveText('YouTrack · e2e.local');
    await expect(page.locator('[data-testid="workspace-board"]')).toBeVisible();
  });
});

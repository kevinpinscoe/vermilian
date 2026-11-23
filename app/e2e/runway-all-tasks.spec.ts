/**
 * All tasks with the workspace's Runway tickets (VERM-89), YouTrack and Jira.
 *
 * All tasks lists the workspace's project (and Jira board) issues plus the
 * tickets added to its Runway from outside them, each exactly once. A
 * workspace with no projects but tickets on its Runway has All tasks; one
 * with neither keeps "Select a project". A Done Runway ticket follows Show
 * closed / Show done like any other, and when that hides every ticket the
 * view says so and offers the toggle.
 *
 * Fake YouTrack: TEST (0-e1) issues 1..6, TST2 (0-e2) 1..2, INB (0-e3) 1 —
 * none of them resolved, so the hidden-by-toggle case runs on Jira (DEMO-109
 * is Done) and is unit-tested for both in allTasks.test.ts.
 *
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function seed(page: Page, workspaceId: string, issueIds: string[]): Promise<void> {
  for (const issueId of issueIds) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [workspaceId, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

/** Every key the YouTrack All tasks table lists, in order, duplicates kept. */
const ytRows = (page: Page) =>
  page.locator('[data-testid="ws-issue-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-id')));
/** Every key the Jira board shows, sorted, duplicates kept. */
const jiraCards = async (page: Page) =>
  (await page.locator('[data-testid="jira-card"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-key')))).sort();

// Fictional values only (ADR-0011 §10).
const YT_BASE: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2eyt89',
  name: 'Runway Tasks',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [],
  boards: {},
  dismissals: {},
};
const JIRA_BACKEND: WorkspaceDocument['backend'] = {
  kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1',
};

test.describe('All tasks with Runway tickets', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Launches per-workspace storage with `docs` and makes `active` the active workspace. */
  async function launchWith(docs: WorkspaceDocument[], active: string): Promise<Page> {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const doc of docs) {
      expect((await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc)).ok).toBe(true);
    }
    await page.reload();
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: active }).click();
    await expect(tid(page, 'workspace-switcher')).toContainText(active);
    return page;
  }

  test('YouTrack, no projects: "Select a project" until the Runway has tickets, then each once in All tasks', async () => {
    const page = await launchWith([YT_BASE], 'Runway Tasks');
    // Neither projects nor Runway tickets: the placeholder.
    await tid(page, 'nav-all-tasks').click();
    await expect(page.getByText('Select a project from the left rail to get started.')).toBeVisible();

    await seed(page, YT_BASE.workspaceId, ['yt:TEST-2', 'yt:TST2-1', 'yt:INB-1', 'yt:TEST-5', 'yt:TST2-2']);
    await page.reload();
    await tid(page, 'nav-all-tasks').click();
    await expect.poll(async () => (await ytRows(page)).sort()).toEqual(['INB-1', 'TEST-2', 'TEST-5', 'TST2-1', 'TST2-2']);
    await expect(page.getByText('Select a project from the left rail to get started.')).toHaveCount(0);
    await expect(tid(page, 'ws-issue-count')).toHaveText('5 open');
  });

  test('YouTrack with a project: a ticket in the project and on the Runway appears once; an outside one is added and edits refresh it', async () => {
    const doc: WorkspaceDocument = {
      ...YT_BASE,
      folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
    };
    const page = await launchWith([doc], 'Runway Tasks');
    await seed(page, doc.workspaceId, ['yt:TEST-3', 'yt:INB-1']);
    // Seeded through the raw IPC, which (unlike every UI route) refreshes no
    // cache, while All tasks is already showing: reload to read the Runway.
    await page.reload();
    await tid(page, 'nav-all-tasks').click();
    await expect.poll(async () => (await ytRows(page)).sort()).toEqual(['INB-1', 'TEST-1', 'TEST-2', 'TEST-3', 'TEST-4', 'TEST-5', 'TEST-6']);

    // An inline edit to the outside Runway ticket shows in its row.
    const chip = page.locator('[data-testid="ws-issue-row"][data-issue-id="INB-1"] [data-testid="chip-cell"][data-field="priority"]');
    await expect(chip).toHaveText('Normal');
    await chip.click();
    await page.locator('[data-testid="chip-option"][data-value="Critical"]').click();
    await expect(chip).toHaveText('Critical');
    expect((await ytRows(page)).filter((k) => k === 'INB-1')).toHaveLength(1);
  });

  test('Jira, no projects or boards: the Runway tickets show once, under the note; Done follows Show done', async () => {
    const doc: WorkspaceDocument = { ...YT_BASE, workspaceId: 'ws-e2ejr89', name: 'Jira Runway Tasks', backend: JIRA_BACKEND };
    const page = await launchWith([doc], 'Jira Runway Tasks');
    await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects or boards chosen yet.');
    await expect(tid(page, 'jira-card')).toHaveCount(0);

    // Only a Done ticket: All tasks stays open and says why it shows nothing.
    await seed(page, doc.workspaceId, ['jira:DEMO-109']);
    await page.reload();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible({ timeout: 15_000 });
    await expect(tid(page, 'jira-board-empty')).toContainText('All tickets are hidden by the current filter');
    await tid(page, 'jira-empty-show-done').click();
    await expect.poll(() => jiraCards(page)).toEqual(['DEMO-109']);
    await tid(page, 'jira-show-done').uncheck();

    await seed(page, doc.workspaceId, ['jira:OPS-7', 'jira:DEMO-101', 'jira:DEMO-102']);
    await page.reload();
    await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects or boards chosen yet.');
    await expect.poll(() => jiraCards(page)).toEqual(['DEMO-101', 'DEMO-102', 'OPS-7']);
    await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
    // A Runway card opens its detail panel.
    await page.locator('[data-testid="jira-card"][data-issue-key="OPS-7"]').click();
    await expect(tid(page, 'jira-issue-detail-panel')).toBeVisible();
  });

  test('Jira with a project: a ticket in the project and on the Runway appears once; an outside one is added', async () => {
    const doc: WorkspaceDocument = {
      ...YT_BASE,
      workspaceId: 'ws-e2ejr89p',
      name: 'Jira Runway Demo',
      backend: JIRA_BACKEND,
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
    };
    const page = await launchWith([doc], 'Jira Runway Demo');
    await expect.poll(() => jiraCards(page)).toEqual(['DEMO-101', 'DEMO-102']);
    await seed(page, doc.workspaceId, ['jira:DEMO-101', 'jira:OPS-7']);
    await page.reload();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => jiraCards(page)).toEqual(['DEMO-101', 'DEMO-102', 'OPS-7']);
    await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
  });
});

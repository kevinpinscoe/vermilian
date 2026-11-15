/**
 * The Priority Desk ranks Jira issues through the Runway metadata store
 * (VERM-38, ADR-0011 §6), against the fake YouTrack and fake Jira.
 *
 * Star a Jira issue on its board card, give it Focus rank 1, set its Why now
 * in the detail panel, and see it in the desk's Now slot. The values live in
 * the local SQLite database in userData, so they survive a relaunch of the
 * same profile. The workspace articles live in the in-memory fake YouTrack,
 * so after the relaunch the spec seeds the same workspace again (same stable
 * ID); only the Runway store carries the ranks across.
 *
 * Nothing is written to Jira at any point: every fake Jira call is a read,
 * and in particular nothing touches Jira's own Rank.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const card = (page: Page, key: string) => page.locator(`[data-testid="jira-card"][data-issue-key="${key}"]`);

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2eyt1',
  name: 'Workspace A',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
};

const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-e2ejd1',
  name: 'Jira desk',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

// The only fake Jira functions anything may call: all reads.
const READS = new Set([
  'detectCloudId', 'getMyself', 'probeJiraToken', 'jiraApiBase', 'searchJql', 'getIssue', 'listProjects',
  'searchProjectIssues', 'searchProjectRecentlyUpdated', 'getEditMeta', 'getIssueComments',
]);

async function expectNoJiraWrites(page: Page) {
  const fns = new Set((await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).map((c) => c.fn));
  expect([...fns].filter((f) => !READS.has(f))).toEqual([]);
  expect([...fns].filter((f) => /rank/i.test(f))).toEqual([]);
}

async function launchIntoJiraWorkspace(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchAppWithUserDataDir(userDataDir, { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const doc of [YT, JIRA]) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  if (!(await tid(page, 'workspace-switcher').textContent())?.includes('Jira desk')) {
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira desk' }).click();
  }
  await expect(tid(page, 'jira-workspace-board')).toBeVisible();
  await expect(card(page, 'DEMO-101')).toBeVisible();
  return { app, page };
}

test.describe('Priority Desk — Jira issues', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('star, rank 1 and Why now persist across a relaunch and never write Jira', async () => {
    const userDataDir = freshUserDataDir();
    let page: Page;
    ({ app, page } = await launchIntoJiraWorkspace(userDataDir));

    // An empty desk first.
    await tid(page, 'nav-priority-desk').click();
    await expect(tid(page, 'priority-desk')).toHaveAttribute('data-backend', 'jira');
    await expect(tid(page, 'priority-desk-all-empty')).toBeVisible();
    await expect(tid(page, 'priority-desk-empty-now')).toBeVisible();

    // Star DEMO-101 on its board card, then give it rank 1.
    await tid(page, 'nav-all-tasks').click();
    await tid(page, 'jira-focus-star-DEMO-101').click();
    await expect(tid(page, 'jira-focus-star-DEMO-101')).toHaveAttribute('aria-pressed', 'true');
    await tid(page, 'jira-focus-rank-badge-DEMO-101').click();
    await tid(page, 'jira-focus-rank-option-DEMO-101-1').click();
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-101')).toHaveText('1');
    // The star is not a card click: the detail panel stays closed.
    await expect(tid(page, 'jira-issue-detail-panel')).toHaveCount(0);

    // Why now, in the detail panel.
    await card(page, 'DEMO-101').click();
    await expect(tid(page, 'jira-runway-section')).toBeVisible();
    await tid(page, 'jira-why-now-input').fill('Credentials expire Friday');
    await tid(page, 'jira-why-now-save').click();
    await expect(tid(page, 'jira-why-now-save')).toBeDisabled();
    await tid(page, 'jira-detail-close').click();

    // The desk's Now slot holds it, with its live Jira summary.
    await tid(page, 'nav-priority-desk').click();
    const now = tid(page, 'priority-desk-slot-now');
    await expect(now.locator('[data-testid="priority-desk-card-DEMO-101"]')).toContainText('Rotate the staging database credentials');
    await expect(tid(page, 'priority-desk-why-now-DEMO-101')).toHaveText('“Credentials expire Friday”');
    await expect(tid(page, 'priority-desk-empty-next')).toBeVisible();

    await expectNoJiraWrites(page);
    await app.close();
    app = undefined;

    // Relaunch the same profile: the store still holds all three values.
    ({ app, page } = await launchIntoJiraWorkspace(userDataDir));
    await expect(tid(page, 'jira-focus-star-DEMO-101')).toHaveAttribute('aria-pressed', 'true');
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-101')).toHaveText('1');
    await expect(tid(page, 'jira-focus-star-DEMO-102')).toHaveAttribute('aria-pressed', 'false');

    await tid(page, 'nav-priority-desk').click();
    await expect(
      tid(page, 'priority-desk-slot-now').locator('[data-testid="priority-desk-card-DEMO-101"]'),
    ).toContainText('Rotate the staging database credentials');
    await expect(tid(page, 'priority-desk-why-now-DEMO-101')).toHaveText('“Credentials expire Friday”');

    expect(await page.evaluate(() => window.vermilian.runwayGet({ workspaceId: 'ws-e2ejd1', issueId: 'jira:DEMO-101' }))).toEqual({
      ok: true,
      entry: { issueId: 'jira:DEMO-101', focus: true, focusRank: 1, whyNow: 'Credentials expire Friday' },
    });
    await expectNoJiraWrites(page);
  });

  test('taking a held rank asks first and leaves the old holder starred', async () => {
    let page: Page;
    ({ app, page } = await launchIntoJiraWorkspace(freshUserDataDir()));

    await tid(page, 'jira-focus-star-DEMO-101').click();
    await tid(page, 'jira-focus-rank-badge-DEMO-101').click();
    await tid(page, 'jira-focus-rank-option-DEMO-101-1').click();
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-101')).toHaveText('1');

    await tid(page, 'jira-focus-star-DEMO-102').click();
    await tid(page, 'jira-focus-rank-badge-DEMO-102').click();
    await tid(page, 'jira-focus-rank-option-DEMO-102-1').click();
    await expect(tid(page, 'jira-focus-rank-conflict-dialog')).toContainText('DEMO-101');

    // Keep: nothing changes.
    await tid(page, 'jira-focus-rank-conflict-keep').click();
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-101')).toHaveText('1');
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-102')).toHaveText('–');

    // Move: DEMO-102 takes rank 1, DEMO-101 stays starred with no rank.
    await tid(page, 'jira-focus-rank-badge-DEMO-102').click();
    await tid(page, 'jira-focus-rank-option-DEMO-102-1').click();
    await tid(page, 'jira-focus-rank-conflict-move').click();
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-102')).toHaveText('1');
    await expect(tid(page, 'jira-focus-rank-badge-DEMO-101')).toHaveText('–');
    await expect(tid(page, 'jira-focus-star-DEMO-101')).toHaveAttribute('aria-pressed', 'true');

    await tid(page, 'nav-priority-desk').click();
    await expect(
      tid(page, 'priority-desk-slot-now').locator('[data-testid="priority-desk-card-DEMO-102"]'),
    ).toBeVisible();
    await expectNoJiraWrites(page);
  });
});

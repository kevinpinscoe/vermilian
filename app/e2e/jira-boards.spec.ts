/**
 * Jira workspaces choosing Jira boards (VERM-59), against the fake YouTrack
 * and fake Jira.
 *
 * Fake Jira boards (src/main/api/fakeJira.ts): board 1 "DEMO planned work"
 * holds DEMO-101 (open) and DEMO-109 (Done); board 2 "Ops tasks" holds OPS-7
 * and DEMO-102 — a board spanning two projects, so a workspace that chose only
 * that board must still show and open DEMO-102.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import type { FakeJiraChange } from '../src/main/api/fakeJira';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const card = (page: Page, key: string) => page.locator(`[data-testid="jira-card"][data-issue-key="${key}"]`);
const MINUTE = 60_000;

async function cardKeys(page: Page): Promise<string[]> {
  return (await tid(page, 'jira-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-issue-key') ?? ''))).sort();
}

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

function jira(projectIds: string[], jiraBoards?: Array<{ id: number; name: string }>): WorkspaceDocument {
  return {
    ...YT,
    workspaceId: 'ws-e2ejb1',
    name: 'Jira boards',
    order: 1,
    backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
    folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds }],
    ...(jiraBoards ? { jiraBoards } : {}),
  };
}

const READS = new Set([
  'detectCloudId', 'getMyself', 'probeJiraToken', 'jiraApiBase', 'searchJql', 'getIssue', 'listProjects',
  'searchProjectIssues', 'searchProjectRecentlyUpdated', 'getEditMeta', 'getIssueComments',
  'listBoards', 'searchBoardIssues', 'listProjectStatuses',
]);

async function launch(doc: WorkspaceDocument, { clock = false } = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const d of [YT, doc]) {
    const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
    expect(r.ok).toBe(true);
  }
  if (clock) await page.clock.install();
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira boards' }).click();
  await expect(tid(page, 'jira-workspace-board')).toBeVisible();
  return { app, page };
}

async function expectReadOnly(page: Page) {
  const fns = new Set((await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).map((c) => c.fn));
  expect([...fns].filter((f) => !READS.has(f))).toEqual([]);
}

let app: ElectronApplication;
let page: Page;
test.afterEach(async () => { await app.close(); });

test('the picker lists boards and saves a board-only selection, whose issues span projects', async () => {
  ({ app, page } = await launch(jira([])));
  await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects or boards chosen yet.');

  await tid(page, 'choose-jira-projects-btn').click();
  const rows = tid(page, 'jira-boards-row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="jira-boards-row"][data-board-id="2"]')).toContainText('Ops tasks');
  await page.locator('[data-testid="jira-boards-row"][data-board-id="2"] input').check();
  await tid(page, 'jira-projects-save').click();

  await expect(tid(page, 'jira-workspace-boards')).toHaveText('Jira boards: Ops tasks');
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-102', 'OPS-7']);

  const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
  const saved = listed.ok ? listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : [])).find((d) => d.workspaceId === 'ws-e2ejb1') : undefined;
  expect(saved?.jiraBoards).toEqual([{ id: 2, name: 'Ops tasks' }]);
  expect(saved?.folders.flatMap((f) => f.projectIds)).toEqual([]);

  // Reopening shows the saved choice.
  await tid(page, 'choose-jira-projects-btn').click();
  await expect(page.locator('[data-testid="jira-boards-row"][data-board-id="2"] input')).toBeChecked();
  await expect(page.locator('[data-testid="jira-boards-row"][data-board-id="1"] input')).not.toBeChecked();
  await expectReadOnly(page);
});

test("a board's issue from an unchosen project opens; anything off the workspace's boards is refused", async () => {
  ({ app, page } = await launch(jira([], [{ id: 2, name: 'Ops tasks' }])));
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-102', 'OPS-7']);

  await card(page, 'DEMO-102').click();
  await expect(tid(page, 'jira-detail-issue-key')).toHaveText('DEMO-102');

  // Not on board 2 and not in a chosen project.
  const detail = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssueDetail({ workspaceId: 'ws-e2ejb1', issueKey: 'DEMO-101' }));
  expect(detail.ok).toBe(false);
  // A board the workspace did not choose.
  const other = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejb1', boardId: 1 }));
  expect(other.ok).toBe(false);
  if (!other.ok) expect(other.message).toMatch(/not one of this workspace's Jira boards/);

  const calls = await page.evaluate(() => window.vermilian.debugGetJiraCalls!());
  expect(calls.filter((c) => c.fn === 'searchBoardIssues').every((c) => c.boardId === 2)).toBe(true);
  await expectReadOnly(page);
});

test('projects and boards together show each issue once', async () => {
  ({ app, page } = await launch(jira(['DEMO'], [{ id: 2, name: 'Ops tasks' }])));
  await expect(tid(page, 'jira-workspace-projects')).toHaveText('Jira projects: DEMO');
  await expect(tid(page, 'jira-workspace-boards')).toHaveText('Jira boards: Ops tasks');
  // DEMO-102 is both in DEMO and on the board: one card.
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-101', 'DEMO-102', 'OPS-7']);
  await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
});

test('Show done brings in a board\'s Done issues; the board search finds them too', async () => {
  ({ app, page } = await launch(jira([], [{ id: 1, name: 'DEMO planned work' }])));
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-101']);

  await tid(page, 'board-search-input').fill('legacy runbook');
  await expect(page.locator('[data-testid="board-search-result"][data-issue-key="DEMO-109"]')).toBeVisible();
  await tid(page, 'board-search-input').press('Escape');

  await tid(page, 'jira-show-done').check();
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-101', 'DEMO-109']);
});

test("a board's poll updates its cards without a reload", async () => {
  ({ app, page } = await launch(jira([], [{ id: 2, name: 'Ops tasks' }]), { clock: true }));
  await expect.poll(() => cardKeys(page)).toEqual(['DEMO-102', 'OPS-7']);
  const change: FakeJiraChange = { op: 'edit', key: 'DEMO-102', summary: 'Document the on-call handover (edited in Jira)' };
  expect(await page.evaluate((c) => window.vermilian.debugJiraChange!(c), change)).toBe(true);

  await page.clock.runFor(MINUTE + 1000);
  await expect(card(page, 'DEMO-102')).toContainText('(edited in Jira)');
  const polls = (await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).filter(
    (c) => c.fn === 'searchBoardIssues' && (c.jql ?? '').startsWith('updated >='),
  );
  expect(polls.length).toBeGreaterThan(0);
  expect(polls[0]).toMatchObject({ boardId: 2, jql: 'updated >= -5m ORDER BY updated DESC' });
  await expectReadOnly(page);
});

test('Test connection names a missing board scope', async () => {
  app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_JIRA_NO_BOARD_SCOPE: '1' });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  await tid(page, 'topbar-settings-btn').click();
  await page.locator('[data-testid="jira-site-url"] input, input[data-testid="jira-site-url"]').first().fill('https://example.atlassian.net/');
  await page.locator('[data-testid="jira-email"] input, input[data-testid="jira-email"]').first().fill('me@example.com');
  await tid(page, 'jira-test-btn').click();
  const result = tid(page, 'jira-test-result');
  await expect(result).toContainText('Connected');
  await expect(result).toContainText('read:board-scope:jira-software');
});

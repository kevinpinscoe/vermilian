/**
 * A Jira board keeps itself fresh by polling (VERM-39), against the fake Jira.
 *
 * The renderer's clock is Playwright's fake clock, so a minute of polling
 * runs in milliseconds: runFor() fires every interval due in the span, as a
 * running app would; fastForward() jumps the clock and fires a due timer once,
 * as a machine waking from sleep does. The fake Jira runs in the main process
 * on the real clock and stamps an issue's `updated` when a spec changes it,
 * so its `updated >= -5m` window behaves as Jira's does.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import type { FakeJiraChange } from '../src/main/api/fakeJira';

const MINUTE = 60_000;
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

const jiraWorkspace = (workspaceId: string, name: string, order: number, projectIds: string[]): WorkspaceDocument => ({
  ...YT,
  workspaceId,
  name,
  order,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds }],
});

// Nothing the board does may write to Jira: only these fake functions read.
const READS = new Set([
  'detectCloudId', 'getMyself', 'probeJiraToken', 'jiraApiBase', 'searchJql', 'getIssue', 'listProjects',
  'searchProjectIssues', 'searchProjectRecentlyUpdated', 'getEditMeta', 'getIssueComments',
]);

let app: ElectronApplication;
let page: Page;

async function change(c: FakeJiraChange) {
  expect(await page.evaluate((x) => window.vermilian.debugJiraChange!(x), c)).toBe(true);
}

async function calls() {
  return page.evaluate(() => window.vermilian.debugGetJiraCalls!());
}

/** How many times `fn` was called for one project. */
async function count(fn: string, projectKey: string) {
  return (await calls()).filter((c) => c.fn === fn && c.projectKey === projectKey).length;
}

async function expectReadOnly() {
  const fns = new Set((await calls()).map((c) => c.fn));
  expect([...fns].filter((f) => !READS.has(f))).toEqual([]);
}

async function openWorkspace(name: string) {
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
  await expect(tid(page, 'jira-workspace-board')).toBeVisible();
  await expect(tid(page, 'jira-workspace-board')).toContainText(name);
}

test.beforeEach(async () => {
  app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const doc of [YT, jiraWorkspace('ws-e2ejp1', 'Jira demo', 1, ['DEMO']), jiraWorkspace('ws-e2ejp2', 'Jira ops', 2, ['OPS'])]) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
    expect(r.ok).toBe(true);
  }
  // The fake clock must be in place before the app's code loads.
  await page.clock.install();
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
  await openWorkspace('Jira demo');
  await expect(tid(page, 'jira-card')).toHaveCount(2);
});

test.afterEach(async () => {
  await app.close();
});

test('an issue edited in Jira updates on the board without a reload', async () => {
  const fullReads = await count('searchProjectIssues', 'DEMO');
  await change({ op: 'edit', key: 'DEMO-101', summary: 'Rotate the staging credentials (edited in Jira)' });
  await expect(card(page, 'DEMO-101')).toContainText('Rotate the staging database credentials');

  await page.clock.runFor(MINUTE + 1000);
  await expect(card(page, 'DEMO-101')).toContainText('(edited in Jira)');
  // It came from the incremental poll, not a full read.
  expect(await count('searchProjectRecentlyUpdated', 'DEMO')).toBeGreaterThan(0);
  expect(await count('searchProjectIssues', 'DEMO')).toBe(fullReads);
  const polls = (await calls()).filter((c) => c.fn === 'searchProjectRecentlyUpdated');
  expect(polls[0].jql).toBe('project = "DEMO" AND updated >= -5m ORDER BY updated DESC');
  await expectReadOnly();
});

test('a newly created issue appears', async () => {
  await change({ op: 'create', id: '10150', key: 'DEMO-150', summary: 'A brand-new fictional issue' });
  await page.clock.runFor(MINUTE + 1000);
  await expect(card(page, 'DEMO-150')).toContainText('A brand-new fictional issue');
  await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');
});

test('an issue resolved in Jira leaves the board while Show done is off', async () => {
  await change({ op: 'edit', key: 'DEMO-102', status: { name: 'Done', category: 'done' } });
  await page.clock.runFor(MINUTE + 1000);
  await expect(card(page, 'DEMO-102')).toHaveCount(0);
  await expect(tid(page, 'jira-issue-count')).toHaveText('1 issues');

  await tid(page, 'jira-show-done').check();
  await expect(card(page, 'DEMO-102')).toBeVisible();
});

test('the periodic full read removes deleted and moved-away issues the poll cannot see', async () => {
  await change({ op: 'delete', key: 'DEMO-102' });
  // Moved to a project this workspace does not show, without touching it.
  await change({ op: 'move', key: 'DEMO-101', toKey: 'ELSEWHERE-1' });

  // Polls alone cannot notice: neither issue matches the poll any more.
  await page.clock.runFor(3 * MINUTE);
  await expect(card(page, 'DEMO-102')).toBeVisible();
  await expect(card(page, 'DEMO-101')).toBeVisible();

  // The full read every ten minutes does.
  await page.clock.runFor(8 * MINUTE);
  await expect(tid(page, 'jira-card')).toHaveCount(0);
  await expectReadOnly();
});

test('after sleep longer than the lookback, the next poll is a full read', async () => {
  const fullReads = await count('searchProjectIssues', 'DEMO');
  const polls = await count('searchProjectRecentlyUpdated', 'DEMO');
  // While the machine sleeps: one issue deleted, one edited long enough ago
  // to have left the poll's five-minute window by the time it wakes. The
  // window is the fake Jira's real clock, so the deletion stands in for both:
  // only a full read can see it.
  await change({ op: 'delete', key: 'DEMO-102' });

  await page.clock.fastForward(7 * MINUTE);
  await expect(card(page, 'DEMO-102')).toHaveCount(0);
  await expect.poll(() => count('searchProjectIssues', 'DEMO')).toBeGreaterThan(fullReads);
  // The broken chain was not bridged by an incremental poll.
  expect(await count('searchProjectRecentlyUpdated', 'DEMO')).toBe(polls);

  // Polling resumes afterwards.
  await page.clock.runFor(MINUTE + 1000);
  await expect.poll(() => count('searchProjectRecentlyUpdated', 'DEMO')).toBeGreaterThan(polls);
});

test('switching workspaces during a poll: the late answer never reaches the new board, and the old poll stops', async () => {
  await change({ op: 'create', id: '10160', key: 'DEMO-160', summary: 'Created while the poll was in flight' });
  await page.evaluate(() => window.vermilian.debugSetJiraSearchDelay!(2500));
  const before = await count('searchProjectRecentlyUpdated', 'DEMO');
  await page.clock.runFor(MINUTE + 1000);
  await expect.poll(() => count('searchProjectRecentlyUpdated', 'DEMO')).toBeGreaterThan(before);

  // The DEMO poll is now held in the fake Jira. Switch away.
  await openWorkspace('Jira ops');
  await expect(card(page, 'OPS-7')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000); // let the held DEMO answer arrive
  await expect(tid(page, 'jira-card')).toHaveCount(1);
  await expect(card(page, 'DEMO-160')).toHaveCount(0);
  await page.evaluate(() => window.vermilian.debugSetJiraSearchDelay!(0));

  // The left workspace is no longer polled; the new one is.
  const demoPolls = await count('searchProjectRecentlyUpdated', 'DEMO');
  const opsPolls = await count('searchProjectRecentlyUpdated', 'OPS');
  await page.clock.runFor(3 * MINUTE);
  await expect.poll(() => count('searchProjectRecentlyUpdated', 'OPS')).toBeGreaterThan(opsPolls);
  expect(await count('searchProjectRecentlyUpdated', 'DEMO')).toBe(demoPolls);
  await expectReadOnly();
});

// Playwright's Chromium focus emulation keeps document.visibilityState at
// 'visible' even after BrowserWindow.hide(), so the spec sets the page's
// visibility itself and fires the event a real hide fires. React Query's
// focusManager reads exactly these two things. In the app, Electron's default
// backgroundThrottling (which Vermilian does not change) makes a hidden or
// minimized window report 'hidden'.
async function setVisibility(state: 'hidden' | 'visible') {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);
}

test('polling stops while the window is hidden and resumes when it is shown', async () => {
  await setVisibility('hidden');
  const polls = await count('searchProjectRecentlyUpdated', 'DEMO');
  const fullReads = await count('searchProjectIssues', 'DEMO');

  await page.clock.runFor(15 * MINUTE);
  expect(await count('searchProjectRecentlyUpdated', 'DEMO')).toBe(polls);
  expect(await count('searchProjectIssues', 'DEMO')).toBe(fullReads);

  // Shown again after a long gap: a full read first, then polling.
  await change({ op: 'delete', key: 'DEMO-102' });
  await setVisibility('visible');
  await expect(card(page, 'DEMO-102')).toHaveCount(0, { timeout: 10_000 });
  expect(await count('searchProjectIssues', 'DEMO')).toBeGreaterThan(fullReads);
  await page.clock.runFor(MINUTE + 1000);
  await expect.poll(() => count('searchProjectRecentlyUpdated', 'DEMO')).toBeGreaterThan(polls);
  await expectReadOnly();
});

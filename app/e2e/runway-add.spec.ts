/**
 * Adding a ticket to the Runway from the Runway view (VERM-86): by key, by
 * link and by search, at the end or at a chosen #N. The exact key is checked
 * once on the workspace's own connection when Add is submitted; a link is
 * checked against the workspace's own tracker host before any request; a
 * typo, a foreign-host link and the other tracker's link are refused with a
 * clear message and leave the order as it was; a duplicate keeps its row and
 * number; a workspace switch while the check is in flight — A → B, or a round
 * trip A → B → A — cancels the add and leaves both Runways untouched; and no
 * project ever moves.
 *
 * The Jira workspace has no projects and no boards, so its very first add is
 * of a ticket nothing else in the workspace admits.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const rows = (page: Page) => tid(page, 'runway-list').locator('[data-testid="runway-row"]');
const row = (page: Page, itemId: string) => tid(page, 'runway-list').locator(`[data-testid="runway-row"][data-item-id="${itemId}"]`);
const itemOrder = (page: Page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''));

async function add(page: Page, text: string, at = '', via: 'enter' | 'button' = 'enter') {
  await tid(page, 'runway-add-number').fill(at);
  await tid(page, 'runway-add-input').fill(text);
  if (via === 'enter') await tid(page, 'runway-add-input').press('Enter');
  else await tid(page, 'runway-add-submit').click();
}

/** A refused add: the message shows and the Runway order is exactly as it was. */
async function expectRefused(page: Page, text: string, message: string | RegExp, before: string[]) {
  await add(page, text);
  await expect(tid(page, 'runway-add-error')).toContainText(message);
  await expect(tid(page, 'runway-add-retry')).toHaveCount(0);
  expect(await itemOrder(page)).toEqual(before);
}

test.describe('Runway view: add a ticket', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('a Jira workspace with no projects or boards: key, link, #N, typo, foreign host, duplicate, switches during the check', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    // Fictional values only (ADR-0011 §10).
    const youtrack: WorkspaceDocument = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId: 'ws-e2eyt86',
      name: 'Workspace A',
      order: 0,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
      ai: { credentialRef: null },
      folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
      boards: {},
      dismissals: {},
    };
    const jira: WorkspaceDocument = {
      ...youtrack,
      workspaceId: 'ws-e2ejr86',
      name: 'Jira Runway',
      order: 1,
      backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [], // no projects and no boards
    };
    for (const doc of [youtrack, jira]) {
      const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
      expect(r.ok).toBe(true);
    }
    await page.reload();

    const switchTo = async (name: string) => {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    };
    const sources = async () => {
      const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
      if (!listed.ok) throw new Error(listed.message);
      return listed.workspaces.flatMap((e) => (e.status === 'ok' ? [[e.document.workspaceId, e.document.folders, e.document.jiraBoards ?? []]] : []));
    };
    const jiraGets = async (key: string) =>
      (await page.evaluate(() => window.vermilian.debugGetJiraCalls!())).filter((c) => c.fn === 'getIssue' && c.key === key).length;

    await switchTo('Jira Runway');
    await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects or boards chosen yet.');
    const sourcesBefore = await sources();

    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-empty')).toBeVisible();

    // 1. The first add, by key (typed in lower case), at the end: checked once, then added.
    const getsBefore = await jiraGets('OPS-7');
    await add(page, 'ops-7');
    await expect(tid(page, 'runway-add-added')).toHaveText('Added OPS-7 as #1.');
    await expect(row(page, 'jira:OPS-7')).toHaveAttribute('data-state', 'resolved');
    await expect(row(page, 'jira:OPS-7').getByTestId('runway-number')).toHaveText('1');
    expect(await jiraGets('OPS-7')).toBeGreaterThan(getsBefore);
    await expect(tid(page, 'runway-add-input')).toHaveValue('');

    // 2. By link, at #1, with the Add button.
    await add(page, 'https://example.atlassian.net/browse/DEMO-101', '1', 'button');
    await expect(tid(page, 'runway-add-added')).toHaveText('Added DEMO-101 as #1.');
    await expect.poll(() => itemOrder(page)).toEqual(['jira:DEMO-101', 'jira:OPS-7']);
    await expect(row(page, 'jira:OPS-7').getByTestId('runway-number')).toHaveText('2');
    const order = await itemOrder(page);

    // 3. A typo: refused with the agreed message, nothing added.
    await expectRefused(page, 'DEMO-9999', 'Ticket missing or not readable with this workspace’s credential.', order);
    await expect(tid(page, 'runway-add-input')).toHaveValue('DEMO-9999');

    // 4. A link to another host, and the other tracker's link: refused before any request.
    const before102 = await jiraGets('DEMO-102');
    await expectRefused(page, 'https://other.example.test/browse/DEMO-102', /not on this workspace’s tracker.*example\.atlassian\.net/, order);
    await expectRefused(page, 'http://e2e.local/issue/TEST-1', /not on this workspace’s tracker/, order);
    expect(await jiraGets('DEMO-102')).toBe(before102);

    // 5. Already on this Runway.
    // A duplicate keeps its original row and number.
    await expectRefused(page, 'OPS-7', 'OPS-7 is already on this Runway as #2.', order);
    await expect(row(page, 'jira:OPS-7').getByTestId('runway-number')).toHaveText('2');

    // 6. A switch while the check is in flight cancels the add.
    await page.evaluate(() => window.vermilian.debugSetJiraGetIssueDelay!(2_000));
    await add(page, 'DEMO-102');
    await expect(tid(page, 'runway-add-checking')).toHaveText('Checking DEMO-102…');
    await switchTo('Workspace A');
    await expect.poll(() => jiraGets('DEMO-102'), { timeout: 5_000 }).toBeGreaterThan(before102);
    // Let the held read answer, then look: DEMO-102 was not added.
    await page.waitForTimeout(2_500);
    await page.evaluate(() => window.vermilian.debugSetJiraGetIssueDelay!(0));
    const listed = await page.evaluate(() => window.vermilian.runwayItemsList({ workspaceId: 'ws-e2ejr86' }));
    expect(listed.ok && listed.items.map((i) => i.itemId)).toEqual(['jira:DEMO-101', 'jira:OPS-7']);
    await switchTo('Jira Runway');
    await tid(page, 'nav-runway').click();
    await expect.poll(() => itemOrder(page)).toEqual(order);
    await expect(tid(page, 'runway-add-error')).toHaveCount(0);

    // 7. A → B → A while the check is in flight: back on the same workspace, the add is still
    //    cancelled (by switch generation), and neither workspace's Runway changes.
    const ytRunway = async () => {
      const r = await page.evaluate(() => window.vermilian.runwayItemsList({ workspaceId: 'ws-e2eyt86' }));
      return r.ok ? r.items.map((i) => [i.itemId, i.runwayNumber]) : r;
    };
    const jiraRunway = async () => {
      const r = await page.evaluate(() => window.vermilian.runwayItemsList({ workspaceId: 'ws-e2ejr86' }));
      return r.ok ? r.items.map((i) => [i.itemId, i.runwayNumber]) : r;
    };
    const bothBefore = { a: await jiraRunway(), b: await ytRunway() };
    expect(bothBefore).toEqual({ a: [['jira:DEMO-101', 1], ['jira:OPS-7', 2]], b: [] });
    const roundTripGets = await jiraGets('DEMO-102');
    await page.evaluate(() => window.vermilian.debugSetJiraGetIssueDelay!(2_000));
    await add(page, 'DEMO-102');
    await expect(tid(page, 'runway-add-checking')).toHaveText('Checking DEMO-102…');
    await expect.poll(() => jiraGets('DEMO-102'), { timeout: 5_000 }).toBeGreaterThan(roundTripGets);
    await switchTo('Workspace A');
    await switchTo('Jira Runway');
    await expect(tid(page, 'runway-view')).toBeVisible();
    await page.waitForTimeout(2_500);
    await page.evaluate(() => window.vermilian.debugSetJiraGetIssueDelay!(0));
    expect({ a: await jiraRunway(), b: await ytRunway() }).toEqual(bothBefore);
    await expect.poll(() => itemOrder(page)).toEqual(order);
    await expect(tid(page, 'runway-add-added')).toHaveCount(0);
    await expect(tid(page, 'runway-add-error')).toHaveCount(0);

    // No project or board moved, in any workspace.
    expect(await sources()).toEqual(sourcesBefore);
  });

  test('a YouTrack workspace: key, link at #1, a search pick at #2, a project-view link, a duplicate, and foreign links refused', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const configBefore = await page.evaluate(() => window.vermilian.getWorkspaceConfig());

    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-empty')).toBeVisible();

    await add(page, 'TEST-2');
    await expect(tid(page, 'runway-add-added')).toHaveText('Added TEST-2 as #1.');
    await add(page, 'http://e2e.local/issue/TEST-3', '1');
    await expect(tid(page, 'runway-add-added')).toHaveText('Added TEST-3 as #1.');
    await expect.poll(() => itemOrder(page)).toEqual(['yt:TEST-3', 'yt:TEST-2']);

    // Search runs over the workspace's own projects; a pick is added like a key.
    await tid(page, 'runway-add-number').fill('2');
    await tid(page, 'runway-add-input').fill('progress task 5');
    const pick = tid(page, 'runway-add-results').locator('[data-testid="runway-add-result"][data-issue-key="TEST-5"]');
    await expect(pick).toBeVisible();
    await pick.click();
    await expect(tid(page, 'runway-add-added')).toHaveText('Added TEST-5 as #2.');
    await expect.poll(() => itemOrder(page)).toEqual(['yt:TEST-3', 'yt:TEST-5', 'yt:TEST-2']);
    for (const id of ['yt:TEST-3', 'yt:TEST-5', 'yt:TEST-2']) await expect(row(page, id)).toHaveAttribute('data-state', 'resolved');

    // A project-view link on the same host (PR 197 review).
    await add(page, 'http://e2e.local/projects/TEST/issues/TEST-6');
    await expect(tid(page, 'runway-add-added')).toHaveText('Added TEST-6 as #4.');
    await expect.poll(() => itemOrder(page)).toEqual(['yt:TEST-3', 'yt:TEST-5', 'yt:TEST-2', 'yt:TEST-6']);

    const order = await itemOrder(page);
    // The same ticket again, by its project-view link: refused, and TEST-5 keeps #2.
    await expectRefused(page, 'http://e2e.local/projects/TEST/issues/TEST-5', 'TEST-5 is already on this Runway as #2.', order);
    await expect(row(page, 'yt:TEST-5').getByTestId('runway-number')).toHaveText('2');
    // A project-view link on another host is refused before any request.
    await expectRefused(page, 'https://other.example.test/projects/TEST/issues/TEST-1', /not on this workspace’s tracker.*e2e\.local/, order);
    await expectRefused(page, 'https://example.atlassian.net/browse/OPS-7', /not on this workspace’s tracker.*e2e\.local/, order);
    await expectRefused(page, 'TEST-999', 'Ticket missing or not readable with this workspace’s credential.', order);

    // No project moved: the workspace configuration is exactly as it was.
    expect(await page.evaluate(() => window.vermilian.getWorkspaceConfig())).toEqual(configBefore);
  });
});

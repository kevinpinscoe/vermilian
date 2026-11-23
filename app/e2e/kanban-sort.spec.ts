/**
 * Sorting cards within each Kanban status column (VERM-93), YouTrack and Jira.
 *
 * YouTrack project boards' Kanban view has its own sort control, remembered
 * per workspace in app-config.json's kanbanSorts — apart from All tasks' —
 * and each card carries the All tasks Runway # cell, whose presses never
 * start a card drag. Jira's All tasks board sorts its columns' cards with the
 * All tasks sort (allTasksSorts). Both keep the column order; with no sort
 * the cards keep today's order. Tracker priority ranks each card by its own
 * project's configured order, Runway tickets from other projects included.
 *
 * Fake YouTrack: TEST (0-e1) — To do: TEST-1 Normal, TEST-2 Critical,
 * TEST-3 Minor, TEST-4 Major; In Progress: TEST-5 Normal, TEST-6 Critical.
 * Fake Jira: DEMO-102 (To Do, Medium), DEMO-101 (In Progress), OPS-7
 * (Waiting), plus tickets this spec creates. Synthetic keys, names and hosts.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import type { FakeJiraChange } from '../src/main/api/fakeJira';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

function config(userData: string): { allTasksSorts?: unknown; kanbanSorts?: unknown } {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-config.json'), 'utf8')) as { allTasksSorts?: unknown; kanbanSorts?: unknown };
}

async function runwayOrder(page: Page, workspaceId: string): Promise<string[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  return r.items.filter((i) => i.kind === 'issue').map((i) => i.itemId);
}

async function addToRunway(page: Page, workspaceId: string, ids: string[]) {
  for (const issueId of ids) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [workspaceId, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

// ─── YouTrack project board Kanban ────────────────────────────────────────────

const YT_WS = 'ws-kanban-yt';
const ARTICLE = JSON.stringify({
  version: 1,
  workspaces: [{ id: YT_WS, name: 'Kanban Alpha', order: 0, folders: [{ id: 'folder-k', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }] }],
  activeWorkspaceId: YT_WS,
  boards: {},
});
// TEST's bundle puts Minor first, unlike the built-in list.
const BUNDLES = JSON.stringify({ TEST: ['Minor', 'Show-stopper', 'Critical', 'Major', 'Normal'] });

const ytColumns = (page: Page) =>
  tid(page, 'kanban-column').evaluateAll((cs) => cs.map((c) => c.getAttribute('data-status') ?? ''));
const ytCards = (page: Page, status: string) =>
  page.locator(`[data-testid="kanban-column"][data-status="${status}"] [data-testid="kanban-card"]`)
    .evaluateAll((cs) => cs.map((c) => c.getAttribute('data-issue-id') ?? ''));
const ytCell = (page: Page, key: string) =>
  page.locator(`[data-testid="kanban-card"][data-issue-id="${key}"] [data-testid="runway-cell"]`);

test.describe('Kanban sort — YouTrack project boards (VERM-93)', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData: string;

  async function launch() {
    app = await launchAppWithUserDataDir(userData, { VERMILIAN_E2E_ARTICLE_CONTENT: ARTICLE, VERMILIAN_E2E_YT_PRIORITY_BUNDLES: BUNDLES });
    page = await app.firstWindow();
    await expect(tid(page, 'workspace-switcher')).toContainText('Kanban Alpha', { timeout: 15_000 });
  }
  async function openKanban() {
    await page.locator('[data-testid="nav-project"]').filter({ hasText: 'Test Project' }).first().click();
    await page.locator('[data-testid="view-tab"][data-view-type="kanban"]').click();
    await expect(tid(page, 'kanban-board')).toBeVisible();
    await expect.poll(() => ytCards(page, 'To do')).toHaveLength(4);
  }

  test.beforeEach(async () => {
    userData = freshUserDataDir();
    await launch();
    // The Runway: TEST-5 #1 (In Progress), TEST-2 #2, TEST-4 #3 (To do).
    await addToRunway(page, YT_WS, ['yt:TEST-5', 'yt:TEST-2', 'yt:TEST-4']);
    await page.reload();
    await expect(tid(page, 'workspace-switcher')).toContainText('Kanban Alpha', { timeout: 15_000 });
    await openKanban();
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('each sort orders the cards within each column, both ways; the columns never move', async () => {
    const columns = await ytColumns(page);
    const defaultToDo = await ytCards(page, 'To do');
    await expect(tid(page, 'kanban-sort-select')).toHaveValue('');

    const choose = async (key: string, direction: 'asc' | 'desc') => {
      await tid(page, 'kanban-sort-select').selectOption(key);
      if ((await tid(page, 'kanban-sort-direction').getAttribute('data-direction')) !== direction) {
        await tid(page, 'kanban-sort-direction').click();
      }
      await expect(tid(page, 'kanban-sort-direction')).toHaveAttribute('data-direction', direction);
    };
    const expectCards = async (toDo: string[], inProgress: string[]) => {
      await expect.poll(() => ytCards(page, 'To do')).toEqual(toDo);
      await expect.poll(() => ytCards(page, 'In Progress')).toEqual(inProgress);
      expect(await ytColumns(page)).toEqual(columns);
    };

    await choose('runwayNumber', 'asc');
    await expectCards(['TEST-2', 'TEST-4', 'TEST-1', 'TEST-3'], ['TEST-5', 'TEST-6']);
    await choose('runwayNumber', 'desc');
    await expectCards(['TEST-4', 'TEST-2', 'TEST-1', 'TEST-3'], ['TEST-5', 'TEST-6']);

    // TEST's own bundle: TEST-3 (Minor) outranks TEST-2 (Critical), whose ID is smaller.
    await choose('priority', 'asc');
    await expectCards(['TEST-3', 'TEST-2', 'TEST-4', 'TEST-1'], ['TEST-6', 'TEST-5']);
    await choose('priority', 'desc');
    await expectCards(['TEST-1', 'TEST-4', 'TEST-2', 'TEST-3'], ['TEST-5', 'TEST-6']);

    await choose('ticketId', 'asc');
    await expectCards(['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4'], ['TEST-5', 'TEST-6']);
    await choose('ticketId', 'desc');
    await expectCards(['TEST-4', 'TEST-3', 'TEST-2', 'TEST-1'], ['TEST-6', 'TEST-5']);

    // Clear: today's order again.
    await tid(page, 'kanban-sort-clear').click();
    await expect.poll(() => ytCards(page, 'To do')).toEqual(defaultToDo);
    await expect(tid(page, 'kanban-sort-clear')).toHaveCount(0);
  });

  test('the Kanban sort is remembered on its own, apart from All tasks, across a relaunch', async () => {
    await tid(page, 'kanban-sort-select').selectOption('priority');
    await tid(page, 'kanban-sort-direction').click();
    await expect.poll(() => config(userData).kanbanSorts).toEqual({ [YT_WS]: { key: 'priority', direction: 'desc' } });
    expect(config(userData).allTasksSorts ?? {}).toEqual({});

    // All tasks has no sort of its own yet.
    await tid(page, 'nav-all-tasks').click();
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');

    await app!.close();
    await launch();
    await openKanban();
    await expect(tid(page, 'kanban-sort-select')).toHaveValue('priority');
    await expect.poll(() => ytCards(page, 'To do')).toEqual(['TEST-1', 'TEST-4', 'TEST-2', 'TEST-3']);
  });

  test("each card's Runway # cell opens its popover and moves the ticket, without opening or dragging the card", async () => {
    await expect(ytCell(page, 'TEST-2')).toHaveAttribute('data-runway-number', '2');
    await expect(ytCell(page, 'TEST-3')).toHaveAttribute('data-runway-number', '');

    await ytCell(page, 'TEST-3').click();
    await expect(tid(page, 'runway-cell-popover')).toBeVisible();
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);
    await tid(page, 'cell-runway-number-input').fill('1');
    await tid(page, 'cell-runway-add-at').click();
    await expect(ytCell(page, 'TEST-3').getByTestId('runway-cell-number')).toHaveText('#1');
    await expect.poll(() => runwayOrder(page, YT_WS)).toEqual(['yt:TEST-3', 'yt:TEST-5', 'yt:TEST-2', 'yt:TEST-4']);
    await page.keyboard.press('Escape');
    await expect(tid(page, 'runway-cell-popover')).toHaveCount(0);

    // Pressing on the cell and dragging it onto another column moves nothing.
    const from = await ytCell(page, 'TEST-1').boundingBox();
    const to = await page.locator('[data-testid="kanban-column"][data-status="In Progress"]').boundingBox();
    if (!from || !to) throw new Error('no layout');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    // Give a stray drop time to patch the status, then check it did not.
    await page.waitForTimeout(500);
    expect(await ytCards(page, 'To do')).toContain('TEST-1');
    expect(await ytCards(page, 'In Progress')).not.toContain('TEST-1');
  });
});

// ─── Jira All tasks board ────────────────────────────────────────────────────

const JIRA: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-kanban-jr',
  name: 'Kanban Jira',
  order: 0,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
  boards: {},
  dismissals: {},
};

const jiraCards = (page: Page, status: string) =>
  page.locator(`[data-testid="jira-column"][data-status="${status}"] [data-testid="jira-card"]`)
    .evaluateAll((cs) => cs.map((c) => c.getAttribute('data-issue-key') ?? ''));
const jiraColumns = (page: Page) =>
  tid(page, 'jira-column').evaluateAll((cs) => cs.map((c) => c.getAttribute('data-status') ?? ''));

test.describe('Kanban sort — Jira All tasks board (VERM-93)', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData: string;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test("each sort orders the cards within each column by the All tasks sort, priority by each project's own scheme", async () => {
    userData = freshUserDataDir();
    app = await launchAppWithUserDataDir(userData, { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    expect((await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), JIRA)).ok).toBe(true);
    // To Do: DEMO-102 (Medium), plus DEMO-110 (Low) and DEMO-111 (High) —
    // DEMO-110 has the smaller ID but is less urgent — and PLAT-4 (P2), a
    // ticket from outside the workspace's projects, ranked by PLAT's scheme.
    const changes: FakeJiraChange[] = [
      { op: 'create', id: '20110', key: 'DEMO-110', summary: 'Low card', priority: 'Low' },
      { op: 'create', id: '20111', key: 'DEMO-111', summary: 'High card', priority: 'High' },
      { op: 'create', id: '20304', key: 'PLAT-4', summary: 'Outside card', priority: 'P2' },
    ];
    for (const c of changes) expect(await page.evaluate((x) => window.vermilian.debugJiraChange!(x), c)).toBe(true);
    // The Runway: PLAT-4 #1, DEMO-110 #2.
    await addToRunway(page, JIRA.workspaceId, ['jira:PLAT-4', 'jira:DEMO-110']);
    await page.reload();
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: JIRA.name }).click();
    await expect.poll(() => jiraCards(page, 'To Do'), { timeout: 15_000 }).toHaveLength(4);

    const columns = await jiraColumns(page);
    const defaultToDo = await jiraCards(page, 'To Do');
    const choose = async (key: string, direction: 'asc' | 'desc') => {
      await tid(page, 'jira-sort-select').selectOption(key);
      if ((await tid(page, 'jira-sort-direction').getAttribute('data-direction')) !== direction) {
        await tid(page, 'jira-sort-direction').click();
      }
      await expect(tid(page, 'jira-sort-direction')).toHaveAttribute('data-direction', direction);
    };
    const expectToDo = async (keys: string[]) => {
      await expect.poll(() => jiraCards(page, 'To Do')).toEqual(keys);
      expect(await jiraColumns(page)).toEqual(columns);
    };

    await choose('priority', 'asc');
    await expectToDo(['DEMO-111', 'PLAT-4', 'DEMO-102', 'DEMO-110']);
    await choose('priority', 'desc');
    await expectToDo(['DEMO-110', 'DEMO-102', 'DEMO-111', 'PLAT-4']);

    await choose('runwayNumber', 'asc');
    await expectToDo(['PLAT-4', 'DEMO-110', 'DEMO-102', 'DEMO-111']);
    await choose('runwayNumber', 'desc');
    await expectToDo(['DEMO-110', 'PLAT-4', 'DEMO-102', 'DEMO-111']);

    await choose('ticketId', 'asc');
    await expectToDo(['DEMO-102', 'DEMO-110', 'DEMO-111', 'PLAT-4']);
    await expect.poll(() => config(userData).allTasksSorts).toEqual({ [JIRA.workspaceId]: { key: 'ticketId', direction: 'asc' } });
    expect(config(userData).kanbanSorts ?? {}).toEqual({});

    // Clear: compareJiraIssues' order again.
    await tid(page, 'jira-sort-clear').click();
    await expect.poll(() => jiraCards(page, 'To Do')).toEqual(defaultToDo);
    await expect.poll(() => config(userData).allTasksSorts).toEqual({});
  });
});

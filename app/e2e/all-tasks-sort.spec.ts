/**
 * The YouTrack All tasks sort control (VERM-92).
 *
 * Runway #, Tracker priority and Ticket ID, each ascending or descending,
 * list every visible ticket as one flat list (no status sections). The
 * Runway # and Priority column headers choose the same sorts; the other
 * headers are temporary and leave the remembered sort alone. Each workspace
 * remembers its own sort in app-config.json on this computer, so it survives
 * a relaunch; Clear sort removes only that workspace's entry. Switching sorts
 * writes no Runway position and no tracker field — the remembered sort is the
 * only thing saved.
 *
 * Fake YouTrack: TEST (0-e1) issues 1..6 — 1 Normal, 2 Critical, 3 Minor,
 * 4 Major, 5 Normal, 6 Critical; 1..4 To do, 5..6 In Progress — and TST2
 * (0-e2) issues 1 (To do) and 2 (In Progress). Synthetic keys, names and
 * hosts only.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const WS_A = 'ws-sort-a';
const WS_B = 'ws-sort-b';
// Two workspaces in the shared _vermilian-config Article, seeded on every launch.
const ARTICLE = JSON.stringify({
  version: 1,
  workspaces: [
    { id: WS_A, name: 'Sort Alpha', order: 0, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }] },
    { id: WS_B, name: 'Sort Beta', order: 1, folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e2'] }] },
  ],
  activeWorkspaceId: WS_A,
  boards: {},
});

/** The rows top to bottom, by key. */
async function rows(page: Page): Promise<string[]> {
  return tid(page, 'ws-issue-row').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-issue-id') ?? ''));
}

async function runwayOrder(page: Page, workspaceId: string): Promise<string[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  return r.items.map((i) => `${i.itemId}@${i.position}`);
}

function savedSorts(userData: string): unknown {
  const raw = JSON.parse(fs.readFileSync(path.join(userData, 'app-config.json'), 'utf8')) as { allTasksSorts?: unknown };
  return raw.allTasksSorts ?? {};
}

async function switchTo(page: Page, name: string) {
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
  await expect(tid(page, 'workspace-switcher')).toContainText(name);
  await tid(page, 'nav-all-tasks').click();
  await expect(tid(page, 'ws-issue-row').first()).toBeVisible({ timeout: 15_000 });
}

/** Records every IPC channel the main process handles from now on. */
async function spyIpc(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    if (!handlers) throw new Error('ipcMain._invokeHandlers is not available in this Electron');
    const g = globalThis as unknown as { __ipcLog: string[] };
    g.__ipcLog = [];
    for (const [channel, fn] of handlers) {
      handlers.set(channel, (...args: unknown[]) => {
        g.__ipcLog.push(channel);
        return fn(...args);
      });
    }
  });
}
async function ipcLog(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __ipcLog: string[] }).__ipcLog.splice(0));
}
// A channel that changes something — a Runway write, a tracker write, or any
// other save — judged by its verb, the part after the colon.
const WRITE = /^(save|update|add|remove|move|delete|patch|create|post|import-confirm|set|migrate|checkpoint|clear|force|resync)/i;
const isWrite = (channel: string) => WRITE.test(channel.split(':')[1] ?? '');

test.describe('All tasks sort (VERM-92)', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData: string;

  /** Launches, then — on a relaunch — waits until the last active workspace's All tasks has loaded. */
  async function launch(restored?: string, env: Record<string, string> = {}) {
    app = await launchAppWithUserDataDir(userData, { VERMILIAN_E2E_ARTICLE_CONTENT: ARTICLE, ...env });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    if (restored) {
      await expect(tid(page, 'workspace-switcher')).toContainText(restored, { timeout: 15_000 });
      await tid(page, 'nav-all-tasks').click();
      await expect(tid(page, 'workspace-board')).toContainText(`${restored} — All tasks`);
      await expect(tid(page, 'ws-issue-row').first()).toBeVisible({ timeout: 15_000 });
    }
  }

  test.beforeEach(async () => {
    userData = freshUserDataDir();
    await launch();
    // Workspace A's Runway: TEST-5 #1 (In Progress), TEST-2 #2 (To do), TEST-6 #3 (In Progress).
    for (const issueId of ['yt:TEST-5', 'yt:TEST-2', 'yt:TEST-6']) {
      const r = await page.evaluate((id) => window.vermilian.runwayItemsAddIssue({ workspaceId: 'ws-sort-a', issueId: id }), issueId);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    await switchTo(page, 'Sort Alpha');
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('each sort in both directions orders All tasks as one flat list; clearing restores the status sections', async () => {
    // No sort: the usual status sections.
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');

    const choose = async (key: string, direction: 'asc' | 'desc') => {
      await tid(page, 'ws-sort-select').selectOption(key);
      if ((await tid(page, 'ws-sort-direction').getAttribute('data-direction')) !== direction) {
        await tid(page, 'ws-sort-direction').click();
      }
      await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', direction);
    };

    // Runway #: straight down across statuses; unnumbered last both ways, by ticket ID.
    await choose('runwayNumber', 'asc');
    await expect.poll(() => rows(page)).toEqual(['TEST-5', 'TEST-2', 'TEST-6', 'TEST-1', 'TEST-3', 'TEST-4']);
    await expect(tid(page, 'ws-group-header')).toHaveCount(0);
    await choose('runwayNumber', 'desc');
    await expect.poll(() => rows(page)).toEqual(['TEST-6', 'TEST-2', 'TEST-5', 'TEST-1', 'TEST-3', 'TEST-4']);

    // Tracker priority: the Priority bundle's order, ties by ticket ID ascending.
    await choose('priority', 'asc');
    await expect.poll(() => rows(page)).toEqual(['TEST-2', 'TEST-6', 'TEST-4', 'TEST-1', 'TEST-5', 'TEST-3']);
    await choose('priority', 'desc');
    await expect.poll(() => rows(page)).toEqual(['TEST-3', 'TEST-1', 'TEST-5', 'TEST-4', 'TEST-2', 'TEST-6']);

    // Ticket ID.
    await choose('ticketId', 'asc');
    await expect.poll(() => rows(page)).toEqual(['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4', 'TEST-5', 'TEST-6']);
    await choose('ticketId', 'desc');
    await expect.poll(() => rows(page)).toEqual(['TEST-6', 'TEST-5', 'TEST-4', 'TEST-3', 'TEST-2', 'TEST-1']);

    // Filters still apply to the flat list.
    await page.locator('[data-testid="ws-filter-pill"][data-section="Status"][data-value="In Progress"]').click();
    await expect.poll(() => rows(page)).toEqual(['TEST-6', 'TEST-5']);
    await page.locator('[data-testid="ws-filter-pill"][data-section="Status"][data-value="In Progress"]').click();

    await tid(page, 'ws-sort-clear').click();
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');
    await expect(tid(page, 'ws-sort-clear')).toHaveCount(0);
  });

  test('the Runway # and Priority headers choose and remember a sort; other headers are temporary', async () => {
    await tid(page, 'ws-runway-header').click();
    await expect(tid(page, 'ws-sort-select')).toHaveValue('runwayNumber');
    await expect.poll(() => rows(page)).toEqual(['TEST-5', 'TEST-2', 'TEST-6', 'TEST-1', 'TEST-3', 'TEST-4']);
    await expect.poll(() => savedSorts(userData)).toEqual({ [WS_A]: { key: 'runwayNumber', direction: 'asc' } });

    await tid(page, 'ws-sort-header-priority').click();
    await expect(tid(page, 'ws-sort-select')).toHaveValue('priority');
    await tid(page, 'ws-sort-header-priority').click();
    await expect(tid(page, 'ws-sort-header-priority')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => savedSorts(userData)).toEqual({ [WS_A]: { key: 'priority', direction: 'desc' } });

    // A temporary header sort: back in status sections, the remembered sort untouched.
    await tid(page, 'ws-sort-header-summary').click();
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');
    await expect(tid(page, 'ws-sort-header-summary')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => savedSorts(userData)).toEqual({ [WS_A]: { key: 'priority', direction: 'desc' } });

    // After a relaunch the remembered sort is back.
    await app!.close();
    await launch('Sort Alpha');
    await switchTo(page, 'Sort Alpha');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('priority');
    await expect.poll(() => rows(page)).toEqual(['TEST-3', 'TEST-1', 'TEST-5', 'TEST-4', 'TEST-2', 'TEST-6']);
  });

  test('switching sorts writes no Runway position and no tracker field; only the remembered sort is saved', async () => {
    const before = await runwayOrder(page, WS_A);
    await spyIpc(app!);

    for (const key of ['runwayNumber', 'priority', 'ticketId']) {
      await tid(page, 'ws-sort-select').selectOption(key);
      await expect(tid(page, 'ws-sort-select')).toHaveValue(key);
      await tid(page, 'ws-sort-direction').click();
      await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'desc');
    }
    await tid(page, 'ws-sort-header-summary').click();
    await tid(page, 'ws-sort-clear').click();
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await expect.poll(() => savedSorts(userData)).toEqual({});

    const channels = await ipcLog(app!);
    expect(channels).toContain('settings:saveConfig');
    expect(channels.filter((c) => isWrite(c) && c !== 'settings:saveConfig')).toEqual([]);
    expect(await runwayOrder(page, WS_A)).toEqual(before);
  });

  test('each workspace remembers its own sort across a relaunch, and clearing one leaves the other', async () => {
    await tid(page, 'ws-sort-select').selectOption('runwayNumber');
    await tid(page, 'ws-sort-direction').click();
    await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'desc');

    await switchTo(page, 'Sort Beta');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');
    await tid(page, 'ws-sort-select').selectOption('ticketId');
    await tid(page, 'ws-sort-direction').click();
    await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'desc');
    await expect.poll(() => savedSorts(userData)).toEqual({
      [WS_A]: { key: 'runwayNumber', direction: 'desc' },
      [WS_B]: { key: 'ticketId', direction: 'desc' },
    });

    await app!.close();
    await launch('Sort Beta');
    await switchTo(page, 'Sort Alpha');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('runwayNumber');
    await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'desc');
    await expect.poll(() => rows(page)).toEqual(['TEST-6', 'TEST-2', 'TEST-5', 'TEST-1', 'TEST-3', 'TEST-4']);
    await switchTo(page, 'Sort Beta');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('ticketId');
    await expect.poll(() => rows(page)).toEqual(['TST2-2', 'TST2-1']);

    // Clear Beta's; Alpha's still restores after another relaunch.
    await tid(page, 'ws-sort-clear').click();
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await expect.poll(() => savedSorts(userData)).toEqual({ [WS_A]: { key: 'runwayNumber', direction: 'desc' } });

    await app!.close();
    await launch('Sort Beta');
    await switchTo(page, 'Sort Beta');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('');
    await switchTo(page, 'Sort Alpha');
    await expect(tid(page, 'ws-sort-select')).toHaveValue('runwayNumber');
    await expect.poll(() => rows(page)).toEqual(['TEST-6', 'TEST-2', 'TEST-5', 'TEST-1', 'TEST-3', 'TEST-4']);
  });

  test("Tracker priority follows each project's configured bundle, from the toolbar and the Priority header", async () => {
    // TEST's bundle puts Minor first, unlike the built-in list: TEST-2
    // (Critical) has the smaller ID but is LESS urgent than TEST-3 (Minor).
    // TST2's bundle puts Major fourth; TST2-2 joins Alpha's Runway from
    // outside its projects and ranks by TST2's bundle, not TEST's.
    const bundles = {
      TEST: ['Minor', 'Show-stopper', 'Critical', 'Major', 'Normal'],
      TST2: ['Show-stopper', 'Critical', 'Normal', 'Major', 'Minor'],
    };
    const r = await page.evaluate(() => window.vermilian.runwayItemsAddIssue({ workspaceId: 'ws-sort-a', issueId: 'yt:TST2-2' }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await app!.close();
    await launch('Sort Alpha', { VERMILIAN_E2E_YT_PRIORITY_BUNDLES: JSON.stringify(bundles) });
    await expect.poll(() => rows(page).then((r) => r.length)).toBe(7);

    const ASC = ['TEST-3', 'TEST-2', 'TEST-6', 'TEST-4', 'TST2-2', 'TEST-1', 'TEST-5'];
    const DESC = ['TEST-1', 'TEST-5', 'TEST-4', 'TST2-2', 'TEST-2', 'TEST-6', 'TEST-3'];

    // The toolbar.
    await tid(page, 'ws-sort-select').selectOption('priority');
    await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'asc');
    await expect.poll(() => rows(page)).toEqual(ASC);
    const asc = await rows(page);
    expect(asc.indexOf('TEST-3')).toBeLessThan(asc.indexOf('TEST-2'));
    await tid(page, 'ws-sort-direction').click();
    await expect(tid(page, 'ws-sort-direction')).toHaveAttribute('data-direction', 'desc');
    await expect.poll(() => rows(page)).toEqual(DESC);

    // The Priority header, from no sort.
    await tid(page, 'ws-sort-clear').click();
    await expect(tid(page, 'ws-group-header')).toHaveCount(2);
    await tid(page, 'ws-sort-header-priority').click();
    await expect(tid(page, 'ws-sort-header-priority')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => rows(page)).toEqual(ASC);
    await tid(page, 'ws-sort-header-priority').click();
    await expect(tid(page, 'ws-sort-header-priority')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => rows(page)).toEqual(DESC);
  });
});

/**
 * Blockers in the Runway view and All tasks (VERM-98), on the proposal's
 * worked example. Fake YouTrack with VERMILIAN_E2E_YT_RUNWAY_FIXTURES=1:
 * READ-14 depends on SYNC-3, and SYNC-7 depends on PLAT-40 (Platform, In
 * Progress), which is not on the Runway. The Runway, in order:
 *
 *   #1 READ-12  #2 SYNC-3  #3 READ-14  #4 SYNC-7  #5 READ-20
 *
 * The checks (Kevin's decisions, VERM-98):
 *   - READ-14 is Blocked by SYNC-3 (#2 here); PLAT-40 shows as external.
 *   - All tasks shows a badge beside Runway # only for Blocked or Unknown,
 *     with the full reason on hover and on keyboard focus.
 *   - An order conflict is flagged and nothing moves until Move prerequisite
 *     above is clicked; then SYNC-3 sits immediately above READ-14.
 *   - Add to Runway puts PLAT-40 immediately above SYNC-7.
 *   - Resolving SYNC-3 turns READ-14 Ready after Refresh, with the order
 *     unchanged; a status edit in the detail panel re-reads on its own.
 *
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const rows = (page: Page) => tid(page, 'runway-list').locator('[data-testid="runway-row"]');
const row = (page: Page, itemId: string) => tid(page, 'runway-list').locator(`[data-testid="runway-row"][data-item-id="${itemId}"]`);
const itemOrder = (page: Page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''));
const blocker = (page: Page, itemId: string) => row(page, itemId).getByTestId('runway-blocker');

// Fictional values only (ADR-0011 §10).
const WS = 'ws-e2eyt98';
const DOC: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: WS,
  name: 'Reader Runway',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  // READ and SYNC are the workspace's projects; PLAT is another team's.
  folders: [{ id: 'folder-r', name: 'Reader', order: 0, parentId: null, projectIds: ['0-e5', '0-e6'] }],
  boards: {},
  dismissals: {},
};
const RUNWAY = ['yt:READ-12', 'yt:SYNC-3', 'yt:READ-14', 'yt:SYNC-7', 'yt:READ-20'];

async function setUp(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  const created = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), DOC);
  expect(created.ok).toBe(true);
  for (const issueId of RUNWAY) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [WS, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  await page.reload();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  return page;
}

async function setStatus(page: Page, key: string, status: string): Promise<void> {
  const r = await page.evaluate(([id, v]) => window.vermilian.patchIssue({ issueId: id, field: 'status', value: v }), [key, status] as const);
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

test.describe('Runway blockers', () => {
  let app: ElectronApplication | undefined;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_YT_RUNWAY_FIXTURES: '1',
    });
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('blocked, external, resolved after Refresh with the order unchanged', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-runway').click();
    await expect.poll(() => itemOrder(page)).toEqual(RUNWAY);

    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'blocked');
    await expect(blocker(page, 'yt:READ-14').getByTestId('runway-blocker-text')).toHaveText('Blocked by SYNC-3 (#2 here).');
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-blocker-text')).toHaveText('Blocked by PLAT-40 (external, In Progress).');
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-add-blocker')).toHaveText('Add PLAT-40 to Runway');
    await expect(blocker(page, 'yt:READ-12')).toHaveAttribute('data-blocker-state', 'ready');
    await expect(blocker(page, 'yt:READ-14').getByTestId('runway-order-conflict')).toHaveCount(0);

    // SYNC-3 is resolved in the tracker. The cached reads still say Blocked;
    // Refresh re-reads past the cache and READ-14 turns Ready.
    await setStatus(page, 'SYNC-3', 'Done');
    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'blocked');
    await tid(page, 'runway-refresh').click();
    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'ready');
    await expect(blocker(page, 'yt:SYNC-3')).toHaveAttribute('data-blocker-state', 'done');
    // PLAT-40 is still external on SYNC-7, and nothing moved.
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-blocker-text')).toHaveText('Blocked by PLAT-40 (external, In Progress).');
    expect(await itemOrder(page)).toEqual(RUNWAY);
  });

  test('a status edit in the detail panel re-reads the Runway: the dependent turns Ready with no Refresh', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-runway').click();
    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'blocked');

    await row(page, 'yt:SYNC-3').getByRole('button', { name: 'Open SYNC-3' }).click();
    const panel = tid(page, 'task-detail-panel');
    await expect(panel.getByTestId('detail-issue-id')).toHaveText('SYNC-3');
    await panel.locator('[data-field="status"] button').click();
    await panel.locator('[data-field="status"] select').selectOption('Done');

    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'ready');
    expect(await itemOrder(page)).toEqual(RUNWAY);
  });

  test('an order conflict is flagged, nothing moves until Move prerequisite above is clicked', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-runway').click();
    await expect(blocker(page, 'yt:READ-14')).toHaveAttribute('data-blocker-state', 'blocked');

    // Kevin moves SYNC-3 below READ-14 himself.
    await row(page, 'yt:SYNC-3').getByTestId('runway-move-down').click();
    const conflicted = ['yt:READ-12', 'yt:READ-14', 'yt:SYNC-3', 'yt:SYNC-7', 'yt:READ-20'];
    await expect.poll(() => itemOrder(page)).toEqual(conflicted);

    const conflict = blocker(page, 'yt:READ-14').getByTestId('runway-order-conflict');
    await expect(conflict).toHaveAttribute('data-certain', 'true');
    await expect(conflict).toContainText('Order conflict — SYNC-3 is #3, after this (#2)');
    await expect(blocker(page, 'yt:READ-14').getByTestId('runway-blocker-text')).toHaveText('Blocked by SYNC-3 (#3 here).');

    // A refresh re-reads and flags it again; it never reorders.
    await tid(page, 'runway-refresh').click();
    await expect(conflict).toBeVisible();
    await page.waitForTimeout(500);
    expect(await itemOrder(page)).toEqual(conflicted);

    await conflict.getByTestId('runway-move-prerequisite').click();
    await expect.poll(() => itemOrder(page)).toEqual(RUNWAY);
    await expect(blocker(page, 'yt:READ-14').getByTestId('runway-order-conflict')).toHaveCount(0);
    await expect(blocker(page, 'yt:READ-14').getByTestId('runway-blocker-text')).toHaveText('Blocked by SYNC-3 (#2 here).');
  });

  test('Add to Runway puts the external blocker immediately above its dependent', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-runway').click();
    await blocker(page, 'yt:SYNC-7').getByTestId('runway-add-blocker').click();

    await expect.poll(() => itemOrder(page)).toEqual(['yt:READ-12', 'yt:SYNC-3', 'yt:READ-14', 'yt:PLAT-40', 'yt:SYNC-7', 'yt:READ-20']);
    await expect(row(page, 'yt:PLAT-40').getByTestId('runway-number')).toHaveText('4');
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-blocker-text')).toHaveText('Blocked by PLAT-40 (#4 here).');
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-add-blocker')).toHaveCount(0);
    await expect(blocker(page, 'yt:SYNC-7').getByTestId('runway-order-conflict')).toHaveCount(0);
  });

  test('All tasks: a badge beside Runway # only for Blocked or Unknown, its reason on hover and focus', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-all-tasks').click();
    const badge = (key: string) => page.locator(`[data-testid="ws-issue-row"][data-issue-id="${key}"] [data-testid="blocker-badge"]`);

    await expect(badge('READ-14')).toHaveText(/^Blocked/);
    await expect(badge('READ-14')).toHaveAttribute('data-blocker-state', 'blocked');
    await expect(badge('SYNC-7')).toHaveAttribute('data-blocker-state', 'blocked');
    await expect(page.locator('[data-testid="ws-issue-row"][data-issue-id="READ-12"]')).toBeVisible();
    await expect(badge('READ-12')).toHaveCount(0);
    await expect(badge('SYNC-3')).toHaveCount(0);

    const reason = badge('READ-14').getByTestId('blocker-badge-reason');
    await expect(reason).toBeHidden();
    await badge('READ-14').hover();
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText('Blocked by SYNC-3 (#2 here).');
    await page.mouse.move(0, 0);
    await expect(reason).toBeHidden();

    await badge('SYNC-7').focus();
    await expect(badge('SYNC-7').getByTestId('blocker-badge-reason')).toBeVisible();
    await expect(badge('SYNC-7').getByTestId('blocker-badge-reason')).toHaveText('Blocked by PLAT-40 (external, In Progress).');
    // Focusing or clicking the badge does not open the row's detail panel.
    await badge('SYNC-7').click();
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);
  });
});

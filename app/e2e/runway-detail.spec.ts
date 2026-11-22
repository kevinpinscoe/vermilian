/**
 * The Runway # control in the ticket detail panel (VERM-88), YouTrack and
 * Jira. Empty, it offers Add at end and Add at #N; filled, it shows the
 * ticket's Runway # and offers Move to #N and Remove (confirmed inline).
 * After every action the stored order is dense and the Runway view shows it.
 *
 * The panel finds the ticket's saved row by every ID it goes by and by the
 * row's tracker read, then moves and removes that row by its stored ID: a
 * Jira ticket saved under a key it has since moved from is found and edited
 * under its stored key, not added a second time. (A YouTrack row saved under
 * an entity ID is covered by rows.test.ts: the fake YouTrack's entity IDs are
 * not of the real N-N form, so no such row can be stored here.)
 *
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import type { FakeJiraChange } from '../src/main/api/fakeJira';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const viewRows = (page: Page) => tid(page, 'runway-list').locator('[data-testid="runway-row"]');

async function seed(page: Page, workspaceId: string, issueIds: string[]): Promise<void> {
  for (const issueId of issueIds) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [workspaceId, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

/** The stored ticket IDs in order; positions and Runway # checked dense on the way. */
async function storedOrder(page: Page, workspaceId: string): Promise<string[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  expect(r.items.map((i) => i.position)).toEqual(r.items.map((_, i) => i + 1));
  expect(r.items.map((i) => i.runwayNumber)).toEqual(r.items.map((_, i) => i + 1));
  return r.items.map((i) => i.itemId);
}

const expectStored = (page: Page, ws: string, expected: string[]) => expect.poll(() => storedOrder(page, ws)).toEqual(expected);

const expectViewOrder = (page: Page, expected: string[]) =>
  expect.poll(() => viewRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')))).toEqual(expected);

const panelNumber = (page: Page) => tid(page, 'detail-runway-number');

async function typeNumber(page: Page, n: string) {
  await tid(page, 'detail-runway-number-input').fill(n);
}

test.describe('Runway # in the ticket detail panel', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('YouTrack: add at #N, move, remove and add at end from the panel; the Runway view follows', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const ws = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;
    await seed(page, ws, ['yt:TEST-3', 'yt:TEST-4']);

    // From the board: TEST-1 is not on the Runway.
    await page.locator('[data-testid="nav-project"]').first().click();
    await page.locator('[data-task-id="0-e1-1"] [data-testid="issue-id"]').click();
    const panel = tid(page, 'task-detail-panel');
    await expect(panel).toBeVisible();
    await expect(panelNumber(page)).toHaveText('Not on this Runway');
    await expect(tid(page, 'detail-runway-move')).toHaveCount(0);
    await expect(tid(page, 'detail-runway-remove')).toHaveCount(0);

    // A # that is not a whole number of 1 or more is refused; nothing is added.
    await typeNumber(page, '0');
    await tid(page, 'detail-runway-add-at').click();
    await expect(tid(page, 'detail-runway-error')).toHaveText('The Runway # must be a whole number of 1 or more.');
    await expectStored(page, ws, ['yt:TEST-3', 'yt:TEST-4']);

    // Add at #1.
    await typeNumber(page, '1');
    await tid(page, 'detail-runway-add-at').click();
    await expect(panelNumber(page)).toHaveText('#1');
    await expectStored(page, ws, ['yt:TEST-1', 'yt:TEST-3', 'yt:TEST-4']);

    // Filled: Move to # and Remove, no Add.
    await expect(tid(page, 'detail-runway-add-end')).toHaveCount(0);
    await typeNumber(page, '3');
    await tid(page, 'detail-runway-move').click();
    await expect(panelNumber(page)).toHaveText('#3');
    await expectStored(page, ws, ['yt:TEST-3', 'yt:TEST-4', 'yt:TEST-1']);

    // Remove asks first; Cancel keeps it.
    await tid(page, 'detail-runway-remove').click();
    await expect(tid(page, 'detail-runway-remove-prompt')).toHaveText('Remove TEST-1 from this Runway?');
    await tid(page, 'detail-runway-remove-cancel').click();
    await expect(panelNumber(page)).toHaveText('#3');
    await tid(page, 'detail-runway-remove').click();
    await tid(page, 'detail-runway-remove-confirm').click();
    await expect(panelNumber(page)).toHaveText('Not on this Runway');
    await expectStored(page, ws, ['yt:TEST-3', 'yt:TEST-4']);

    // Add at end.
    await tid(page, 'detail-runway-add-end').click();
    await expect(panelNumber(page)).toHaveText('#3');
    await expectStored(page, ws, ['yt:TEST-3', 'yt:TEST-4', 'yt:TEST-1']);
    await panel.getByRole('button', { name: 'Close panel' }).click();

    // The Runway view shows it; a move from a panel opened there shows at once.
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();
    await expectViewOrder(page, ['yt:TEST-3', 'yt:TEST-4', 'yt:TEST-1']);
    await viewRows(page).filter({ hasText: 'TEST-1' }).click();
    await expect(panel).toBeVisible();
    await expect(panelNumber(page)).toHaveText('#3');
    await typeNumber(page, '1');
    await tid(page, 'detail-runway-move').click();
    await expectViewOrder(page, ['yt:TEST-1', 'yt:TEST-3', 'yt:TEST-4']);
    await expect(panelNumber(page)).toHaveText('#1');
    await tid(page, 'detail-runway-remove').click();
    await tid(page, 'detail-runway-remove-confirm').click();
    await expectViewOrder(page, ['yt:TEST-3', 'yt:TEST-4']);
  });

  test('Jira: a ticket saved under a key it moved from is found, moved and removed under its stored key', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    // Fictional values only (ADR-0011 §10).
    const jira: WorkspaceDocument = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId: 'ws-e2ejr88',
      name: 'Jira Runway Panel',
      order: 0,
      backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      ai: { credentialRef: null },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
      boards: {},
      dismissals: {},
    };
    expect((await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), jira)).ok).toBe(true);
    await page.reload();
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira Runway Panel' }).click();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible();

    await seed(page, jira.workspaceId, ['jira:OPS-7', 'jira:DEMO-101']);
    // Jira moves DEMO-101 to a new key; the Runway row keeps the old one.
    const change: FakeJiraChange = { op: 'move', key: 'DEMO-101', toKey: 'DEMO-150', touch: true };
    expect(await page.evaluate((c) => window.vermilian.debugJiraChange!(c), change)).toBe(true);
    await page.reload();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible({ timeout: 15_000 });

    const card = (key: string) => page.locator(`[data-testid="jira-card"][data-issue-key="${key}"]`);
    const panel = tid(page, 'jira-issue-detail-panel');

    // DEMO-102: not on the Runway and in no Priority Desk slot — the control is there anyway.
    await card('DEMO-102').click();
    await expect(panel).toBeVisible();
    await expect(panelNumber(page)).toHaveText('Not on this Runway');
    await tid(page, 'jira-detail-close').click();
    await expect(panel).toHaveCount(0);

    // DEMO-150 is the row saved as jira:DEMO-101: found by its tracker read, at #2.
    await card('DEMO-150').click();
    await expect(panel).toBeVisible();
    await expect(panelNumber(page)).toHaveText('#2');
    await expect(tid(page, 'detail-runway-add-end')).toHaveCount(0);

    await typeNumber(page, '1');
    await tid(page, 'detail-runway-move').click();
    await expect(panelNumber(page)).toHaveText('#1');
    await expectStored(page, jira.workspaceId, ['jira:DEMO-101', 'jira:OPS-7']);

    await tid(page, 'detail-runway-remove').click();
    await expect(tid(page, 'detail-runway-remove-prompt')).toHaveText('Remove DEMO-150 from this Runway?');
    await tid(page, 'detail-runway-remove-confirm').click();
    await expect(panelNumber(page)).toHaveText('Not on this Runway');
    await expectStored(page, jira.workspaceId, ['jira:OPS-7']);

    // Added back from the panel, it is stored under its current key.
    await tid(page, 'detail-runway-add-end').click();
    await expect(panelNumber(page)).toHaveText('#2');
    await expectStored(page, jira.workspaceId, ['jira:OPS-7', 'jira:DEMO-150']);
  });
});

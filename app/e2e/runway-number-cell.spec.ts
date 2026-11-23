/**
 * The Runway # in All tasks (VERM-90), YouTrack and Jira.
 *
 * YouTrack's All tasks table has a Runway # column; each Jira card has a
 * Runway # badge beside its key. Each shows the ticket's Runway # on the
 * active workspace's Runway, blank when it has none, and opens a popover
 * holding the detail panel's Runway # control: setting a number there updates
 * the Runway. Clicking the cell never opens the detail panel underneath.
 *
 * Fake YouTrack: TEST (0-e1) issues 1..6. Fake Jira: DEMO-101, DEMO-102.
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const ytCell = (page: Page, key: string) =>
  page.locator(`[data-testid="ws-issue-row"][data-issue-id="${key}"] [data-testid="runway-cell"]`);
const jiraCell = (page: Page, key: string) =>
  page.locator(`[data-testid="jira-card"][data-issue-key="${key}"] [data-testid="runway-cell"]`);
const popover = (page: Page) => tid(page, 'runway-cell-popover');

async function seed(page: Page, workspaceId: string, issueIds: string[]): Promise<void> {
  for (const issueId of issueIds) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [workspaceId, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

/** The saved Runway order, ticket IDs only. */
async function order(page: Page, workspaceId: string): Promise<string[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  return r.items.filter((i) => i.kind === 'issue').map((i) => i.itemId);
}

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2eyt90',
  name: 'Runway Column',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
};
const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-e2ejr90',
  name: 'Jira Runway Column',
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

test.describe('Runway # in All tasks', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function launchWith(doc: WorkspaceDocument, seeded: string[]): Promise<Page> {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    expect((await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc)).ok).toBe(true);
    await seed(page, doc.workspaceId, seeded);
    await page.reload();
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: doc.name }).click();
    await expect(tid(page, 'workspace-switcher')).toContainText(doc.name);
    return page;
  }

  test('YouTrack: the column shows each Runway #, blank when unnumbered, and the popover adds, moves and removes', async () => {
    const page = await launchWith(YT, ['yt:TEST-3', 'yt:TEST-1']);
    await tid(page, 'nav-all-tasks').click();
    await expect(tid(page, 'ws-runway-header')).toHaveText('Runway #');
    await expect(ytCell(page, 'TEST-3')).toHaveAttribute('data-runway-number', '1');
    await expect(ytCell(page, 'TEST-3').getByTestId('runway-cell-number')).toHaveText('#1');
    await expect(ytCell(page, 'TEST-1').getByTestId('runway-cell-number')).toHaveText('#2');
    await expect(ytCell(page, 'TEST-2').getByTestId('runway-cell-number')).toHaveText('');
    await expect(ytCell(page, 'TEST-2')).toHaveAttribute('data-runway-number', '');

    // Add at #1 from an unnumbered row's cell; the row's detail panel stays shut.
    await ytCell(page, 'TEST-2').click();
    await expect(popover(page)).toBeVisible();
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);
    await expect(tid(page, 'cell-runway-number')).toHaveText('Not on this Runway');
    await tid(page, 'cell-runway-number-input').fill('1');
    await tid(page, 'cell-runway-add-at').click();
    await expect(ytCell(page, 'TEST-2').getByTestId('runway-cell-number')).toHaveText('#1');
    await expect(ytCell(page, 'TEST-3').getByTestId('runway-cell-number')).toHaveText('#2');
    await expect(ytCell(page, 'TEST-1').getByTestId('runway-cell-number')).toHaveText('#3');
    await expect.poll(() => order(page, YT.workspaceId)).toEqual(['yt:TEST-2', 'yt:TEST-3', 'yt:TEST-1']);
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);

    // Move to #1 with Enter.
    await ytCell(page, 'TEST-1').click();
    await expect(tid(page, 'cell-runway-number')).toHaveText('#3');
    await tid(page, 'cell-runway-number-input').fill('1');
    await tid(page, 'cell-runway-number-input').press('Enter');
    await expect(ytCell(page, 'TEST-1').getByTestId('runway-cell-number')).toHaveText('#1');
    await expect.poll(() => order(page, YT.workspaceId)).toEqual(['yt:TEST-1', 'yt:TEST-2', 'yt:TEST-3']);
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);

    // A click outside closes it; Remove asks first.
    await tid(page, 'ws-runway-header').click();
    await expect(popover(page)).toHaveCount(0);
    await ytCell(page, 'TEST-3').click();
    await tid(page, 'cell-runway-remove').click();
    await expect(tid(page, 'cell-runway-remove-prompt')).toHaveText('Remove TEST-3 from this Runway?');
    await tid(page, 'cell-runway-remove-confirm').click();
    await expect(ytCell(page, 'TEST-3').getByTestId('runway-cell-number')).toHaveText('');
    await expect.poll(() => order(page, YT.workspaceId)).toEqual(['yt:TEST-1', 'yt:TEST-2']);

    // The Runway view agrees.
    await page.keyboard.press('Escape');
    await tid(page, 'nav-runway').click();
    const rows = tid(page, 'runway-list').locator('[data-testid="runway-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-item-id', 'yt:TEST-1');
    await expect(rows.nth(1)).toHaveAttribute('data-item-id', 'yt:TEST-2');
  });

  test('Jira: each card shows its Runway # badge, blank when unnumbered, and the popover adds and moves', async () => {
    const page = await launchWith(JIRA, ['jira:DEMO-102']);
    await expect(jiraCell(page, 'DEMO-102').getByTestId('runway-cell-number')).toHaveText('#1', { timeout: 15_000 });
    await expect(jiraCell(page, 'DEMO-101').getByTestId('runway-cell-number')).toHaveText('');

    // Add at end; the card's detail panel stays shut.
    await jiraCell(page, 'DEMO-101').click();
    await expect(popover(page)).toBeVisible();
    await expect(tid(page, 'jira-issue-detail-panel')).toHaveCount(0);
    await tid(page, 'cell-runway-add-end').click();
    await expect(jiraCell(page, 'DEMO-101').getByTestId('runway-cell-number')).toHaveText('#2');
    await expect.poll(() => order(page, JIRA.workspaceId)).toEqual(['jira:DEMO-102', 'jira:DEMO-101']);

    // Move to #1.
    await tid(page, 'cell-runway-number-input').fill('1');
    await tid(page, 'cell-runway-move').click();
    await expect(jiraCell(page, 'DEMO-101').getByTestId('runway-cell-number')).toHaveText('#1');
    await expect(jiraCell(page, 'DEMO-102').getByTestId('runway-cell-number')).toHaveText('#2');
    await expect.poll(() => order(page, JIRA.workspaceId)).toEqual(['jira:DEMO-101', 'jira:DEMO-102']);
    await expect(tid(page, 'jira-issue-detail-panel')).toHaveCount(0);

    // Keys typed in the popover never reach the card (Enter would open it).
    await tid(page, 'cell-runway-number-input').fill('x');
    await tid(page, 'cell-runway-number-input').press('Enter');
    await expect(tid(page, 'cell-runway-error')).toContainText('whole number');
    await expect(tid(page, 'jira-issue-detail-panel')).toHaveCount(0);
  });
});

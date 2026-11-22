/**
 * Runway view (VERM-85): opened from the rail, it shows the active
 * workspace's tickets, sections and notes in their stored order, for a
 * YouTrack and a Jira workspace alike. A resolved ticket opens the
 * workspace's existing detail panel, and closing it leaves the order and the
 * list's scroll position as they were. The order is the same after a
 * relaunch of the same profile.
 *
 * The Runway is seeded through the real IPC channels (runwayItems*, VERM-82);
 * tickets are read from the fake YouTrack and fake Jira (runwayItemsResolve,
 * VERM-84). Add, remove and reorder in the view are VERM-86/87.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const rows = (page: Page) => tid(page, 'runway-list').locator('[data-testid="runway-row"]');
const row = (page: Page, itemId: string) => tid(page, 'runway-list').locator(`[data-testid="runway-row"][data-item-id="${itemId}"]`);

/** Enough note rows to make the list scroll. */
const FILLER = 40;

type Step = { issue: string } | { section: string } | { note: string };

async function seed(page: Page, workspaceId: string, steps: Step[]): Promise<void> {
  for (const step of steps) {
    const r = await page.evaluate(
      ([ws, s]) =>
        'issue' in s
          ? window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: s.issue })
          : 'section' in s
            ? window.vermilian.runwayItemsAddSection({ workspaceId: ws, text: s.section })
            : window.vermilian.runwayItemsAddNote({ workspaceId: ws, text: s.note }),
      [workspaceId, step] as const,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

const filler = (label: string): Step[] => Array.from({ length: FILLER }, (_, i) => ({ note: `${label} note ${i + 1}` }));

async function itemOrder(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id') ?? ''));
}

const scrollTopOf = (page: Page) => tid(page, 'runway-list').evaluate((el) => el.scrollTop);

/**
 * Scrolls the list until `itemId` is in view, then opens it, closes the
 * panel with `close`, and checks that the order and scroll position held.
 */
async function openAndCloseKeepsPlace(page: Page, itemId: string, panelId: string, closeTestId: string | null) {
  const before = await itemOrder(page);
  await row(page, itemId).scrollIntoViewIfNeeded();
  const scrolled = await scrollTopOf(page);
  expect(scrolled).toBeGreaterThan(0);

  await row(page, itemId).click();
  await expect(tid(page, panelId)).toBeVisible();
  if (closeTestId) await tid(page, closeTestId).click();
  else await tid(page, panelId).getByRole('button', { name: 'Close panel' }).click();
  await expect(tid(page, panelId)).toHaveCount(0);

  await expect(tid(page, 'runway-view')).toBeVisible();
  await expect.poll(() => scrollTopOf(page)).toBe(scrolled);
  expect(await itemOrder(page)).toEqual(before);
}

test.describe('Runway view', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('a YouTrack Runway: stored order, ticket states, detail panel, relaunch', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir);
    let page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const workspaceId = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;

    await seed(page, workspaceId, [
      { note: 'Ship the offline reader first.' },
      { issue: 'yt:TEST-2' },
      { issue: 'yt:TEST-1' },
      { section: 'Later' },
      { issue: 'yt:GONE-1' },
      ...filler('Later'),
      { issue: 'yt:TEST-4' },
    ]);

    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'nav-runway')).toHaveAttribute('aria-current', 'true');
    await expect(rows(page)).toHaveCount(5 + FILLER + 1);

    const order = await itemOrder(page);
    expect(order[0]).toMatch(/^note:/);
    expect(order.slice(1, 3)).toEqual(['yt:TEST-2', 'yt:TEST-1']);
    expect(order[3]).toMatch(/^sec:/);
    expect(order[4]).toBe('yt:GONE-1');
    expect(order.at(-1)).toBe('yt:TEST-4');

    // Ticket numbers count tickets only; sections and notes keep their text.
    await expect(row(page, 'yt:TEST-2').getByTestId('runway-number')).toHaveText('1');
    await expect(row(page, 'yt:TEST-1').getByTestId('runway-number')).toHaveText('2');
    await expect(row(page, 'yt:GONE-1').getByTestId('runway-number')).toHaveText('3');
    await expect(row(page, 'yt:TEST-4').getByTestId('runway-number')).toHaveText('4');
    await expect(rows(page).nth(0)).toHaveText('Ship the offline reader first.');
    await expect(rows(page).nth(3)).toHaveText('Later');

    // A ticket the tracker answers 404 for stays in place, with its reason.
    await expect(row(page, 'yt:TEST-2')).toHaveAttribute('data-state', 'resolved');
    await expect(row(page, 'yt:GONE-1')).toHaveAttribute('data-state', 'missing-or-unreadable');
    await expect(row(page, 'yt:GONE-1').getByTestId('runway-state')).toHaveText('Missing or not readable');
    await expect(row(page, 'yt:GONE-1').getByTestId('runway-reason')).toContainText('the tracker answered 404');

    // A resolved ticket far down the list opens the YouTrack detail panel;
    // closing it keeps the order and the scroll position.
    await expect(row(page, 'yt:TEST-4')).toHaveAttribute('data-state', 'resolved');
    await openAndCloseKeepsPlace(page, 'yt:TEST-4', 'task-detail-panel', null);

    // An unresolved ticket does not open a panel.
    await row(page, 'yt:GONE-1').click();
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);

    await app.close();
    app = await launchAppWithUserDataDir(userDataDir);
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await tid(page, 'nav-runway').click();
    await expect(rows(page)).toHaveCount(order.length);
    expect(await itemOrder(page)).toEqual(order);
  });

  test('a Jira Runway: a ticket from outside the projects opens the Jira panel and keeps the place', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    // Fictional values only (ADR-0011 §10).
    const base: WorkspaceDocument = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId: 'ws-e2eyt85',
      name: 'Workspace A',
      order: 0,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
      ai: { credentialRef: null },
      folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
      boards: {},
      dismissals: {},
    };
    const jira: WorkspaceDocument = {
      ...base,
      workspaceId: 'ws-e2ejr85',
      name: 'Jira Runway',
      order: 1,
      backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
    };
    for (const doc of [base, jira]) {
      const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira Runway' }).click();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible();

    // OPS-7 is in no project or board of this workspace: only its Runway row admits it.
    await seed(page, 'ws-e2ejr85', [
      { issue: 'jira:DEMO-101' },
      { section: 'Operations' },
      ...filler('Operations'),
      { issue: 'jira:OPS-7' },
      { issue: 'jira:DEMO-999' },
    ]);

    await tid(page, 'nav-runway').click();
    await expect(rows(page)).toHaveCount(2 + FILLER + 2);
    const order = await itemOrder(page);
    expect(order[0]).toBe('jira:DEMO-101');
    expect(order.slice(-2)).toEqual(['jira:OPS-7', 'jira:DEMO-999']);
    await expect(row(page, 'jira:OPS-7').getByTestId('runway-number')).toHaveText('2');
    await expect(row(page, 'jira:OPS-7')).toHaveAttribute('data-state', 'resolved');
    await expect(row(page, 'jira:DEMO-999')).toHaveAttribute('data-state', 'missing-or-unreadable');

    await openAndCloseKeepsPlace(page, 'jira:OPS-7', 'jira-issue-detail-panel', 'jira-detail-close');
  });
});

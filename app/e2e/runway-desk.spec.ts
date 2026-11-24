/**
 * Priority Desk display on the Runway (VERM-99), on the spec's worked
 * example. Fake YouTrack with VERMILIAN_E2E_YT_RUNWAY_FIXTURES=1; the Runway,
 * in order:
 *
 *   #1 READ-12  #2 SYNC-3  #3 READ-14  #4 SYNC-7  #5 READ-20  #6 PLAT-40
 *
 * Desk slots set with today's Desk data: READ-12 Now, SYNC-3 Next, READ-20
 * Then. PLAT-40 carries Focus rank 1 too, but PLAT is not one of this
 * workspace's projects, so it is not on this Desk.
 *
 * The checks (Kevin's decisions, VERM-99):
 *   - Runway and All tasks rows show a read-only Now/Next/Then chip only for
 *     tickets on the active workspace's Desk.
 *   - The Now, Next and Then cards, and YouTrack's Choose next candidates,
 *     show the ticket's Runway # read-only; blank when it is not on the
 *     Runway; the candidate order is unchanged.
 *   - Promoting or demoting on the Desk (its own rank control) never changes
 *     a Runway position.
 *   - Jira: the same, from the workspace's local Desk entries.
 *
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const runwayRow = (page: Page, itemId: string) => tid(page, 'runway-list').locator(`[data-testid="runway-row"][data-item-id="${itemId}"]`);
const wsRow = (page: Page, key: string) => page.locator(`[data-testid="ws-issue-row"][data-issue-id="${key}"]`);

async function storedOrder(page: Page, workspaceId: string): Promise<string[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.ok ? r.items.map((i) => i.itemId) : [];
}

// ─── YouTrack ───────────────────────────────────────────────────────────────

// Fictional values only (ADR-0011 §10).
const WS = 'ws-e2eyt99';
const DOC: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: WS,
  name: 'Reader Desk',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  // READ and SYNC are the workspace's projects; PLAT is another team's.
  folders: [{ id: 'folder-r', name: 'Reader', order: 0, parentId: null, projectIds: ['0-e5', '0-e6'] }],
  boards: {},
  dismissals: {},
};
const RUNWAY = ['yt:READ-12', 'yt:SYNC-3', 'yt:READ-14', 'yt:SYNC-7', 'yt:READ-20', 'yt:PLAT-40'];
// Entity IDs of the fake's fixture tickets.
const ID = { 'READ-12': '0-e5-12', 'READ-14': '0-e5-14', 'READ-20': '0-e5-20', 'SYNC-3': '0-e6-3', 'SYNC-7': '0-e6-7', 'PLAT-40': '0-e7-40' };

async function setUp(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  const created = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), DOC);
  expect(created.ok).toBe(true);
  for (const issueId of RUNWAY) {
    const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [WS, issueId] as const);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  for (const [key, rank] of [['READ-12', 1], ['SYNC-3', 2], ['READ-20', 3], ['PLAT-40', 1]] as const) {
    await page.evaluate(async ([k, n]) => {
      await window.vermilian.patchIssue({ issueId: k, field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId: k, field: 'focusRank', value: n });
    }, [key, rank] as const);
  }
  await page.reload();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  return page;
}

test.describe('Runway and the Priority Desk — YouTrack', () => {
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

  test('Runway and All tasks rows show the Desk slot, only for this Desk\'s tickets', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-runway').click();
    const chip = (itemId: string) => runwayRow(page, itemId).getByTestId('desk-slot');

    await expect(chip('yt:READ-12')).toHaveText('Now');
    await expect(chip('yt:READ-12')).toHaveAttribute('data-desk-slot', 'now');
    await expect(chip('yt:READ-12')).toHaveAttribute('title', 'Priority Desk: Now');
    await expect(chip('yt:SYNC-3')).toHaveAttribute('data-desk-slot', 'next');
    await expect(chip('yt:READ-20')).toHaveAttribute('data-desk-slot', 'then');
    await expect(runwayRow(page, 'yt:READ-14').getByTestId('runway-ticket-id')).toHaveText('READ-14');
    await expect(chip('yt:READ-14')).toHaveCount(0);
    // PLAT-40 holds Focus rank 1 on another workspace's Desk, not this one.
    await expect(runwayRow(page, 'yt:PLAT-40').getByTestId('runway-ticket-id')).toHaveText('PLAT-40');
    await expect(chip('yt:PLAT-40')).toHaveCount(0);

    await tid(page, 'nav-all-tasks').click();
    await expect(wsRow(page, 'READ-12').getByTestId('desk-slot')).toHaveText('Now');
    await expect(wsRow(page, 'SYNC-3').getByTestId('desk-slot')).toHaveText('Next');
    await expect(wsRow(page, 'READ-20').getByTestId('desk-slot')).toHaveText('Then');
    await expect(wsRow(page, 'READ-14')).toBeVisible();
    await expect(wsRow(page, 'READ-14').getByTestId('desk-slot')).toHaveCount(0);
    await expect(wsRow(page, 'PLAT-40')).toBeVisible();
    await expect(wsRow(page, 'PLAT-40').getByTestId('desk-slot')).toHaveCount(0);
  });

  test('Desk cards and Choose next candidates show the Runway #; promoting and demoting never move it', async () => {
    const page = await setUp(app!);
    await tid(page, 'nav-priority-desk').click();
    const deskCard = (key: keyof typeof ID) => tid(page, `priority-desk-card-${ID[key]}`);

    await expect(deskCard('READ-12').getByTestId('desk-runway-number')).toHaveText('Runway #1');
    await expect(tid(page, 'priority-desk-slot-next').getByTestId('desk-runway-number')).toHaveText('Runway #2');
    await expect(tid(page, 'priority-desk-slot-then').getByTestId('desk-runway-number')).toHaveText('Runway #5');

    // Choose next: READ-14 is #3, SYNC-7 #4; READ-9 is not on the Runway, so blank.
    await tid(page, 'priority-desk-mode-choose-next').click();
    const candidate = (id: string) => tid(page, `priority-desk-candidate-${id}`);
    await expect(candidate(ID['READ-14']).getByTestId('desk-runway-number')).toHaveText('Runway #3');
    await expect(candidate(ID['SYNC-7']).getByTestId('desk-runway-number')).toHaveText('Runway #4');
    await expect(candidate('0-e5-9')).toBeVisible();
    await expect(candidate('0-e5-9').getByTestId('desk-runway-number')).toHaveCount(0);

    // Promote SYNC-3 from Next to Now on its Desk card, displacing READ-12.
    await tid(page, 'priority-desk-mode-now').click();
    await tid(page, `focus-rank-badge-${ID['SYNC-3']}`).click();
    await tid(page, `focus-rank-option-${ID['SYNC-3']}-1`).click();
    await tid(page, 'focus-rank-conflict-move').click();
    await expect(tid(page, 'priority-desk-slot-now').getByTestId(`priority-desk-card-${ID['SYNC-3']}`)).toBeVisible();
    await expect(deskCard('SYNC-3').getByTestId('desk-runway-number')).toHaveText('Runway #2');
    await expect(tid(page, 'priority-desk-empty-next')).toBeVisible();
    expect(await storedOrder(page, WS)).toEqual(RUNWAY);

    // Demote SYNC-3 from Now to Then, displacing READ-20.
    await tid(page, `focus-rank-badge-${ID['SYNC-3']}`).click();
    await tid(page, `focus-rank-option-${ID['SYNC-3']}-3`).click();
    await tid(page, 'focus-rank-conflict-move').click();
    await expect(tid(page, 'priority-desk-slot-then').getByTestId(`priority-desk-card-${ID['SYNC-3']}`)).toBeVisible();
    await expect(deskCard('SYNC-3').getByTestId('desk-runway-number')).toHaveText('Runway #2');
    await expect(tid(page, 'priority-desk-empty-now')).toBeVisible();
    expect(await storedOrder(page, WS)).toEqual(RUNWAY);

    // And the Runway view agrees: same order, SYNC-3 now Then, the displaced tickets slotless.
    await tid(page, 'nav-runway').click();
    await expect(runwayRow(page, 'yt:SYNC-3').getByTestId('desk-slot')).toHaveText('Then');
    await expect(runwayRow(page, 'yt:SYNC-3').getByTestId('runway-number')).toHaveText('2');
    await expect(runwayRow(page, 'yt:READ-14').getByTestId('runway-ticket-id')).toHaveText('READ-14');
    for (const itemId of ['yt:READ-12', 'yt:READ-20']) await expect(runwayRow(page, itemId).getByTestId('desk-slot')).toHaveCount(0);
  });
});

// ─── Jira ───────────────────────────────────────────────────────────────────

const JWS = 'ws-e2ejd99';
const JIRA: WorkspaceDocument = {
  ...DOC,
  workspaceId: JWS,
  name: 'Jira desk',
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

test.describe('Runway and the Priority Desk — Jira', () => {
  let app: ElectronApplication | undefined;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('the Desk card shows the Runway #, and the Runway row the Desk slot', async () => {
    const page = await app!.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    expect((await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), JIRA)).ok).toBe(true);
    for (const issueId of ['jira:DEMO-101', 'jira:DEMO-102']) {
      const r = await page.evaluate(([ws, id]) => window.vermilian.runwayItemsAddIssue({ workspaceId: ws, issueId: id }), [JWS, issueId] as const);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const ranked = await page.evaluate((ws) => window.vermilian.runwayUpdate({ workspaceId: ws, issueId: 'jira:DEMO-102', patch: { focus: true, focusRank: 1 } }), JWS);
    expect(ranked.ok, JSON.stringify(ranked)).toBe(true);
    await page.reload();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    await tid(page, 'nav-priority-desk').click();
    await expect(tid(page, 'priority-desk-card-DEMO-102').getByTestId('desk-runway-number')).toHaveText('Runway #2');

    await tid(page, 'nav-runway').click();
    await expect(runwayRow(page, 'jira:DEMO-102').getByTestId('desk-slot')).toHaveText('Now');
    await expect(runwayRow(page, 'jira:DEMO-101').getByTestId('runway-ticket-id')).toHaveText('DEMO-101');
    await expect(runwayRow(page, 'jira:DEMO-101').getByTestId('desk-slot')).toHaveCount(0);
    expect(await storedOrder(page, JWS)).toEqual(['jira:DEMO-101', 'jira:DEMO-102']);
  });
});

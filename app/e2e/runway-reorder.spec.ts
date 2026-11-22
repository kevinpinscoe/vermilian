/**
 * Runway view row actions (VERM-87): Remove (confirmed inline), Move up,
 * Move down, Move to #N, typing a number in the row's # field, and drag.
 * After every action the stored positions are dense 1..N, the Runway # is
 * dense 1..T over tickets only, the view shows the stored order, and the
 * order survives a relaunch of the same profile.
 *
 * Move up / down swap a row with the one immediately beside it: crossing a
 * heading or note keeps the Runway #, crossing a ticket changes it by one.
 * Removing takes the row off the active workspace's Runway only.
 *
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';
import type { RunwayItem } from '../src/shared/runwayItem';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const rows = (page: Page) => tid(page, 'runway-list').locator('[data-testid="runway-row"]');
const row = (page: Page, itemId: string) => tid(page, 'runway-list').locator(`[data-testid="runway-row"][data-item-id="${itemId}"]`);

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

async function stored(page: Page, workspaceId: string): Promise<RunwayItem[]> {
  const r = await page.evaluate((ws) => window.vermilian.runwayItemsList({ workspaceId: ws }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  return r.items;
}

/** Item IDs with sections and notes shown by their text, for readable expectations. */
async function storedOrder(page: Page, workspaceId: string): Promise<string[]> {
  return (await stored(page, workspaceId)).map((i) => (i.kind === 'issue' ? i.itemId : `${i.kind}:${i.text}`));
}

/**
 * The stored rows are `expected`, positions dense 1..N and the Runway #
 * dense 1..T over tickets, and the view shows the same order and numbers.
 */
async function expectOrder(page: Page, workspaceId: string, expected: string[]): Promise<void> {
  await expect.poll(() => storedOrder(page, workspaceId)).toEqual(expected);
  const items = await stored(page, workspaceId);
  expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
  const tickets = items.filter((i) => i.kind === 'issue');
  expect(tickets.map((i) => i.runwayNumber)).toEqual(tickets.map((_, i) => i + 1));
  expect(items.filter((i) => i.kind !== 'issue').every((i) => i.runwayNumber === null)).toBe(true);

  await expect.poll(() => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')))).toEqual(
    items.map((i) => i.itemId),
  );
  for (const t of tickets) {
    await expect(row(page, t.itemId).getByTestId('runway-number')).toHaveText(String(t.runwayNumber));
  }
}

const itemIdOfText = async (page: Page, workspaceId: string, text: string) =>
  (await stored(page, workspaceId)).find((i) => i.text === text)!.itemId;

/** Drags `source` by its handle onto `target` (dnd-kit pointer sensor: past the 6 px activation, then in small steps). */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const handle = await source.getByTestId('runway-drag-handle').boundingBox();
  const to = await target.boundingBox();
  if (!handle || !to) throw new Error('drag: no bounding box');
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + (to.y > y ? 10 : -10), { steps: 3 });
  await page.mouse.move(x, to.y + to.height / 2, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

test.describe('Runway row actions', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('a YouTrack Runway: up, down, Move to #N, typed #, drag and Remove keep it dense, and it survives a relaunch', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir);
    let page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const ws = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;

    await seed(page, ws, [
      { issue: 'yt:TEST-1' },
      { issue: 'yt:TEST-3' },
      { section: 'Later' },
      { issue: 'yt:TEST-4' },
      { issue: 'yt:TEST-5' },
      { note: 'Check the cache first.' },
    ]);
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();
    await expectOrder(page, ws, ['yt:TEST-1', 'yt:TEST-3', 'section:Later', 'yt:TEST-4', 'yt:TEST-5', 'note:Check the cache first.']);

    // The first row cannot move up, the last cannot move down.
    await expect(rows(page).first().getByTestId('runway-move-up')).toBeDisabled();
    await expect(rows(page).last().getByTestId('runway-move-down')).toBeDisabled();

    // ↓ across a ticket: the Runway # changes by one.
    await row(page, 'yt:TEST-1').getByTestId('runway-move-down').click();
    await expectOrder(page, ws, ['yt:TEST-3', 'yt:TEST-1', 'section:Later', 'yt:TEST-4', 'yt:TEST-5', 'note:Check the cache first.']);
    await expect(row(page, 'yt:TEST-1').getByTestId('runway-number')).toHaveText('2');

    // ↓ across a heading: the Runway # stays the same.
    await row(page, 'yt:TEST-1').getByTestId('runway-move-down').click();
    await expectOrder(page, ws, ['yt:TEST-3', 'section:Later', 'yt:TEST-1', 'yt:TEST-4', 'yt:TEST-5', 'note:Check the cache first.']);
    await expect(row(page, 'yt:TEST-1').getByTestId('runway-number')).toHaveText('2');

    // ↑ back across the heading, still #2.
    await row(page, 'yt:TEST-1').getByTestId('runway-move-up').click();
    await expectOrder(page, ws, ['yt:TEST-3', 'yt:TEST-1', 'section:Later', 'yt:TEST-4', 'yt:TEST-5', 'note:Check the cache first.']);

    // A heading moves too, and never takes a number.
    const later = row(page, await itemIdOfText(page, ws, 'Later'));
    await later.getByTestId('runway-move-up').click();
    await expectOrder(page, ws, ['yt:TEST-3', 'section:Later', 'yt:TEST-1', 'yt:TEST-4', 'yt:TEST-5', 'note:Check the cache first.']);

    // Typed #: TEST-5 (#4) to #1.
    await row(page, 'yt:TEST-5').getByTestId('runway-number').click();
    await row(page, 'yt:TEST-5').getByTestId('runway-number-input').fill('1');
    await row(page, 'yt:TEST-5').getByTestId('runway-number-input').press('Enter');
    await expectOrder(page, ws, ['yt:TEST-5', 'yt:TEST-3', 'section:Later', 'yt:TEST-1', 'yt:TEST-4', 'note:Check the cache first.']);

    // A typed # that is not a whole number of 1 or more is refused; nothing moves.
    await row(page, 'yt:TEST-4').getByTestId('runway-number').click();
    await row(page, 'yt:TEST-4').getByTestId('runway-number-input').fill('0');
    await row(page, 'yt:TEST-4').getByTestId('runway-number-input').press('Enter');
    await expect(tid(page, 'runway-edit-error')).toHaveText('The Runway # must be a whole number of 1 or more.');
    await row(page, 'yt:TEST-4').getByTestId('runway-number-input').press('Escape');
    await expectOrder(page, ws, ['yt:TEST-5', 'yt:TEST-3', 'section:Later', 'yt:TEST-1', 'yt:TEST-4', 'note:Check the cache first.']);

    // Move to #N: TEST-5 (#1) to #3 — after the ticket that will precede it.
    await row(page, 'yt:TEST-5').getByTestId('runway-move-to').click();
    await row(page, 'yt:TEST-5').getByTestId('runway-move-to-input').fill('3');
    await row(page, 'yt:TEST-5').getByTestId('runway-move-to-submit').click();
    await expectOrder(page, ws, ['yt:TEST-3', 'section:Later', 'yt:TEST-1', 'yt:TEST-5', 'yt:TEST-4', 'note:Check the cache first.']);
    await expect(tid(page, 'runway-edit-error')).toHaveCount(0);

    // Past the end: last.
    await row(page, 'yt:TEST-3').getByTestId('runway-move-to').click();
    await row(page, 'yt:TEST-3').getByTestId('runway-move-to-input').fill('99');
    await row(page, 'yt:TEST-3').getByTestId('runway-move-to-input').press('Enter');
    await expectOrder(page, ws, ['section:Later', 'yt:TEST-1', 'yt:TEST-5', 'yt:TEST-4', 'yt:TEST-3', 'note:Check the cache first.']);

    // Drag: the note to the top, then TEST-4 onto TEST-1.
    const note = row(page, await itemIdOfText(page, ws, 'Check the cache first.'));
    await dragOnto(page, note, rows(page).first());
    await expectOrder(page, ws, ['note:Check the cache first.', 'section:Later', 'yt:TEST-1', 'yt:TEST-5', 'yt:TEST-4', 'yt:TEST-3']);
    await dragOnto(page, row(page, 'yt:TEST-4'), row(page, 'yt:TEST-1'));
    await expectOrder(page, ws, ['note:Check the cache first.', 'section:Later', 'yt:TEST-4', 'yt:TEST-1', 'yt:TEST-5', 'yt:TEST-3']);

    // Remove asks first, on the row; Cancel keeps everything.
    await row(page, 'yt:TEST-1').getByTestId('runway-remove').click();
    await expect(row(page, 'yt:TEST-1').getByTestId('runway-remove-prompt')).toHaveText('Remove TEST-1 from this Runway?');
    await row(page, 'yt:TEST-1').getByTestId('runway-remove-cancel').click();
    await expect(row(page, 'yt:TEST-1').getByTestId('runway-remove-prompt')).toHaveCount(0);
    await expectOrder(page, ws, ['note:Check the cache first.', 'section:Later', 'yt:TEST-4', 'yt:TEST-1', 'yt:TEST-5', 'yt:TEST-3']);

    // Confirmed, only that row goes and the numbers close up.
    await row(page, 'yt:TEST-1').getByTestId('runway-remove').click();
    await row(page, 'yt:TEST-1').getByTestId('runway-remove-confirm').click();
    await expectOrder(page, ws, ['note:Check the cache first.', 'section:Later', 'yt:TEST-4', 'yt:TEST-5', 'yt:TEST-3']);

    // A heading's prompt shows its text.
    await row(page, await itemIdOfText(page, ws, 'Later')).getByTestId('runway-remove').click();
    await expect(tid(page, 'runway-remove-prompt')).toHaveText('Remove the heading “Later” from this Runway?');
    await tid(page, 'runway-remove-confirm').click();
    await expectOrder(page, ws, ['note:Check the cache first.', 'yt:TEST-4', 'yt:TEST-5', 'yt:TEST-3']);

    // A removed ticket can be added back: it goes at the end.
    await tid(page, 'runway-add-input').fill('TEST-1');
    await tid(page, 'runway-add-submit').click();
    await expect(tid(page, 'runway-add-added')).toHaveText('Added TEST-1 as #4.');
    await expectOrder(page, ws, ['note:Check the cache first.', 'yt:TEST-4', 'yt:TEST-5', 'yt:TEST-3', 'yt:TEST-1']);
    const before = await storedOrder(page, ws);

    await app.close();
    app = await launchAppWithUserDataDir(userDataDir);
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await tid(page, 'nav-runway').click();
    await expectOrder(page, ws, before);
  });

  test('a Jira workspace with no projects or boards: Remove takes the row off this Runway only', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    // Fictional values only (ADR-0011 §10). Neither workspace has projects or boards.
    const a: WorkspaceDocument = {
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId: 'ws-e2ejr87a',
      name: 'Jira Runway A',
      order: 0,
      backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      ai: { credentialRef: null },
      folders: [],
      boards: {},
      dismissals: {},
    };
    const b: WorkspaceDocument = { ...a, workspaceId: 'ws-e2ejr87b', name: 'Jira Runway B', order: 1 };
    for (const doc of [a, b]) {
      const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
      expect(r.ok).toBe(true);
    }
    await page.reload();

    const pick = async (name: string) => {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
      await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects or boards chosen yet.');
    };

    await pick('Jira Runway B');
    await seed(page, b.workspaceId, [{ issue: 'jira:OPS-7' }, { issue: 'jira:DEMO-101' }]);
    const bBefore = await storedOrder(page, b.workspaceId);

    await pick('Jira Runway A');
    await seed(page, a.workspaceId, [{ issue: 'jira:DEMO-101' }, { issue: 'jira:DEMO-102' }, { issue: 'jira:OPS-7' }]);
    await tid(page, 'nav-runway').click();
    await expectOrder(page, a.workspaceId, ['jira:DEMO-101', 'jira:DEMO-102', 'jira:OPS-7']);

    await dragOnto(page, row(page, 'jira:OPS-7'), row(page, 'jira:DEMO-101'));
    await expectOrder(page, a.workspaceId, ['jira:OPS-7', 'jira:DEMO-101', 'jira:DEMO-102']);

    await row(page, 'jira:OPS-7').getByTestId('runway-remove').click();
    await expect(row(page, 'jira:OPS-7').getByTestId('runway-remove-prompt')).toHaveText('Remove OPS-7 from this Runway?');
    await row(page, 'jira:OPS-7').getByTestId('runway-remove-confirm').click();
    await expectOrder(page, a.workspaceId, ['jira:DEMO-101', 'jira:DEMO-102']);

    // Workspace B's Runway — the same tickets, in its own order — is untouched.
    expect(await storedOrder(page, b.workspaceId)).toEqual(bBefore);
    expect(bBefore).toEqual(['jira:OPS-7', 'jira:DEMO-101']);
  });
});

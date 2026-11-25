/**
 * Markdown import preview (VERM-102): Import from Markdown… in the Runway
 * header chooses a schedule file and shows each proposed workspace with its
 * numbered tickets, sections, notes and unticked References, in the packaged
 * app. Nothing is written: after Cancel the Runway database, the app
 * configuration and the workspace configuration are byte-identical to the
 * baselines taken before the picker opened.
 *
 * The file is the spec's section 5 example, with its ticket link on the fake
 * YouTrack's own host (http://e2e.local) instead of yt.example.test, so the
 * link is the workspace's own; the fake's Runway projects READ, SYNC and
 * PLAT are switched on (VERMILIAN_E2E_YT_RUNWAY_FIXTURES). The native picker is stubbed in the main
 * process (app.evaluate). Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

// The fake YouTrack's Runway projects READ, SYNC and PLAT (VERM-94).
const RUNWAY_ENV = { VERMILIAN_E2E_YT_RUNWAY_FIXTURES: '1' };

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const EXAMPLE = [
  '## Ship the offline reader',
  '',
  'Readers lose their place on the train. Target: before the spring release.',
  '',
  '- [ ] http://e2e.local/issue/READ-12 - Cache articles locally',
  '- [ ] SYNC-3 - Conflict-free merge library',
  '- [ ] READ-14 - Sync read state between devices',
  '- [ ] SYNC-7 - Background sync worker',
  '- [ ] READ-20 - Offline indicator in the toolbar',
  '',
  '### Later',
  '',
  '- Look at READ-9 again; it was the first attempt and is mostly obsolete.',
  '',
].join('\n');

// Replaces dialog.showOpenDialog in the main process. `null` means cancelled.
async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const stub = async () => (target === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [target] });
    (dialog as unknown as { showOpenDialog: typeof stub }).showOpenDialog = stub;
  }, filePath);
}

function scratchFile(name: string, content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verm102-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Every file that could hold an import's writes, as bytes (null when absent). */
async function baseline(page: Page, userDataDir: string) {
  const bytes = (name: string) => {
    const p = path.join(userDataDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null;
  };
  const backups = path.join(userDataDir, 'runway-backups');
  return {
    db: bytes('runway-metadata.sqlite'),
    dbWal: bytes('runway-metadata.sqlite-wal'),
    appConfig: bytes('app-config.json'),
    backups: fs.existsSync(backups) ? fs.readdirSync(backups).sort() : [],
    workspaceConfig: JSON.stringify(await page.evaluate(() => window.vermilian.getWorkspaceConfig())),
  };
}

async function openRunway(app: ElectronApplication): Promise<{ page: Page; workspaceId: string }> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  const workspaceId = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;
  await tid(page, 'nav-runway').click();
  await expect(tid(page, 'runway-view')).toBeVisible();
  return { page, workspaceId };
}

test.describe('Runway: Markdown import preview', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('the section 5 example: a proposed workspace with #1..5, its section and notes, READ-9 unticked; Cancel writes nothing', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, RUNWAY_ENV);
    const { page, workspaceId } = await openRunway(app);
    const runwayBefore = await page.evaluate((w) => window.vermilian.runwayItemsList({ workspaceId: w }), workspaceId);
    expect(fs.existsSync(path.join(userDataDir, 'runway-metadata.sqlite'))).toBe(true);

    // Baselines before the picker opens.
    const before = await baseline(page, userDataDir);
    const file = scratchFile('offline-reader.md', EXAMPLE);
    const fileBytes = fs.readFileSync(file);

    await stubOpenDialog(app, file);
    await tid(page, 'runway-import-markdown').click();
    const dialog = tid(page, 'runway-markdown-import');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Import preview — offline-reader.md');

    const groups = dialog.locator('[data-testid="import-group"]');
    await expect(groups).toHaveCount(1);
    const group = groups.first();
    await expect(group.locator('[data-testid="import-group-name"]')).toHaveText('Ship the offline reader');
    await expect(group.locator('[data-testid="import-group-target"]')).toHaveText('New workspace');
    await expect(group.locator('[data-testid="import-connection"]')).toHaveValue(workspaceId);

    // #1..#5 in file order, once matching has answered.
    const tickets = group.locator('[data-testid="import-row"][data-kind="ticket"]');
    await expect(tickets).toHaveCount(5);
    await expect(group.locator('[data-testid="import-row-number"]')).toHaveText(['#1', '#2', '#3', '#4', '#5']);
    expect(await tickets.evaluateAll((els) => els.map((e) => e.getAttribute('data-key')))).toEqual(['READ-12', 'SYNC-3', 'READ-14', 'SYNC-7', 'READ-20']);
    await expect(group.locator('[data-testid="import-group-checking"]')).toHaveCount(0);
    await expect(group.locator('[data-testid="import-group-error"]')).toHaveCount(0);

    // The whole outline, in file order.
    const rows = group.locator('[data-testid="import-row"]');
    expect(await rows.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-kind')}@${e.getAttribute('data-line')}`))).toEqual([
      'note@3', 'ticket@5', 'ticket@6', 'ticket@7', 'ticket@8', 'ticket@9', 'section@11', 'note@13',
    ]);
    await expect(rows.nth(0)).toContainText('Readers lose their place on the train.');
    await expect(rows.nth(1)).toContainText('Cache articles locally');
    await expect(rows.nth(6).locator('[data-testid="import-section-text"]')).toHaveText('Later');
    await expect(rows.nth(7)).toContainText('Look at READ-9 again');

    // READ-9 is a Reference: unticked, with its line and reason.
    const refs = group.locator('[data-testid="import-reference"]');
    await expect(refs).toHaveCount(1);
    await expect(refs.first()).toHaveAttribute('data-line', '13');
    await expect(refs.first()).toHaveAttribute('data-status', 'matched');
    await expect(refs.first()).toContainText('READ-9');
    await expect(refs.first()).toContainText('In prose');
    const tick = refs.first().locator('[data-testid="import-reference-tick"]');
    await expect(tick).not.toBeChecked();
    // Unticked, and since VERM-103 it can be ticked (the corrections test ticks it).
    await expect(tick).toBeEnabled();

    // Cancel is the only footer action.
    await expect(dialog.getByRole('button', { name: 'Apply' })).toHaveCount(0);
    await tid(page, 'import-cancel').click();
    await expect(dialog).toHaveCount(0);

    // Nothing was written.
    const after = await baseline(page, userDataDir);
    expect(after).toEqual(before);
    expect(await page.evaluate((w) => window.vermilian.runwayItemsList({ workspaceId: w }), workspaceId)).toEqual(runwayBefore);
    expect(fs.readFileSync(file).equals(fileBytes)).toBe(true);
    await expect(tid(page, 'runway-view')).toBeVisible();
  });

  test('cancelling the picker returns straight to the Runway', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), RUNWAY_ENV);
    const { page } = await openRunway(app);
    await stubOpenDialog(app, null);
    await tid(page, 'runway-import-markdown').click();
    await expect(tid(page, 'runway-import-markdown')).toBeEnabled();
    await expect(tid(page, 'runway-markdown-import')).toHaveCount(0);
    await expect(tid(page, 'runway-import-error')).toHaveCount(0);
    await expect(tid(page, 'runway-view')).toBeVisible();
  });

  test('a file over 1 MiB is refused in the main process, with no preview', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), RUNWAY_ENV);
    const { page } = await openRunway(app);
    await stubOpenDialog(app, scratchFile('huge.md', Buffer.alloc(1024 * 1024 + 1, 'a')));
    await tid(page, 'runway-import-markdown').click();
    await expect(tid(page, 'runway-import-error')).toContainText('huge.md is larger than 1 MiB');
    await expect(tid(page, 'runway-markdown-import')).toHaveCount(0);
  });

  test('an unmatched scheduled ticket becomes a note, and a name matching the active workspace maps to it', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), RUNWAY_ENV);
    const { page, workspaceId } = await openRunway(app);
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const activeName = config?.workspaces.find((w) => w.id === workspaceId)?.name ?? '';
    expect(activeName).not.toBe('');

    await stubOpenDialog(app, scratchFile('mixed.md', [`## ${activeName.toUpperCase()}`, '', '- [x] READ-14 Done already', '- [ ] GONE-404 Never existed', '- https://other.example.test/issue/READ-20', ''].join('\n')));
    await tid(page, 'runway-import-markdown').click();
    const group = tid(page, 'runway-markdown-import').locator('[data-testid="import-group"]').first();
    await expect(group.locator('[data-testid="import-group-target"]')).toHaveText('Existing workspace');
    await expect(group.locator('[data-testid="import-group-name"]')).toHaveText(activeName.trim());
    await expect(group.locator('[data-testid="import-connection"]')).toHaveCount(0);
    const rows = group.locator('[data-testid="import-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-kind', 'ticket');
    await expect(rows.nth(0)).toContainText('#1');
    await expect(rows.nth(0)).toContainText('[x]');
    await expect(rows.nth(1)).toHaveAttribute('data-kind', 'unmatched');
    await expect(rows.nth(2)).toHaveAttribute('data-kind', 'unmatched');
    await expect(rows.nth(2)).toContainText('Unmatched, kept as a note');
    await tid(page, 'import-cancel').click();
  });

  test('a heading matching two workspaces waits for a choice: no numbers until one is chosen, then checked on it', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { ...RUNWAY_ENV, VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    let page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    // Fictional values only. Workspace A is active; two others are both named Platform.
    const doc = (workspaceId: string, name: string, order: number): WorkspaceDocument => ({
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId,
      name,
      order,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
      ai: { credentialRef: null },
      folders: [{ id: `folder-${order}`, name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
      boards: {},
      dismissals: {},
    });
    for (const d of [doc('ws-e2ea102', 'Workspace A', 0), doc('ws-e2ep102', 'Platform', 1), doc('ws-e2eq102', ' platform', 2)]) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const active = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;
    if (active !== 'ws-e2ea102') {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Workspace A' }).click();
    }
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId).toBe('ws-e2ea102');
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();

    await stubOpenDialog(app, scratchFile('platform.md', ['## PLATFORM', '', '- [ ] READ-14 Sync read state', '- [ ] SYNC-7 Background sync worker', ''].join('\n')));
    await tid(page, 'runway-import-markdown').click();
    const group = tid(page, 'runway-markdown-import').locator('[data-testid="import-group"]').first();
    await expect(group.locator('[data-testid="import-group-target"]')).toHaveAttribute('data-kind', 'ambiguous');
    await expect(group.locator('[data-testid="import-group-choose"]')).toHaveText('Choose a workspace to check these tickets.');
    await expect(group.locator('[data-testid="import-connection"]')).toHaveValue('');
    await expect(group.locator('[data-testid="import-group-checking"]')).toHaveCount(0);
    await expect(group.locator('[data-testid="import-row"][data-kind="unchecked"]')).toHaveCount(2);
    await expect(group.locator('[data-testid="import-row-number"]')).toHaveCount(0);

    // Two workspaces called Platform are told apart by their visible labels.
    const picker = group.locator('[data-testid="import-connection"]');
    await expect(picker.locator('option')).toHaveText([
      'Choose a workspace…',
      'Workspace A',
      'Platform — rail position 2, ID ws-e2ep102',
      'platform — rail position 3, ID ws-e2eq102',
    ]);
    await picker.selectOption({ label: 'platform — rail position 3, ID ws-e2eq102' });
    await expect(picker).toHaveValue('ws-e2eq102');
    await expect(group.locator('[data-testid="import-group-choose"]')).toHaveCount(0);
    await expect(group.locator('[data-testid="import-row-number"]')).toHaveText(['#1', '#2']);
    await tid(page, 'import-cancel').click();
  });

  test('corrections: tick, split, rename (with a Map to workspace offer), merge and skip change the preview; Undo, Reset; Cancel writes nothing', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, RUNWAY_ENV);
    const { page, workspaceId } = await openRunway(app);
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const activeName = (config?.workspaces.find((w) => w.id === workspaceId)?.name ?? '').trim();
    expect(activeName).not.toBe('');

    const before = await baseline(page, userDataDir);
    const file = scratchFile(
      'plan.md',
      [
        '## Reader plan', // 1
        '- READ-12 Cache articles locally', // 2
        '- READ-14 Sync read state', // 3
        '', // 4
        'See READ-9 for the old attempt.', // 5
        '', // 6
        '### Later', // 7
        '- READ-20 Offline indicator', // 8
        '', // 9
        '## Sync work', // 10
        '- SYNC-3 Merge library', // 11
        '', // 12
        '## Notes to drop', // 13
        '- SYNC-7 Background worker', // 14
        '',
      ].join('\n'),
    );
    await stubOpenDialog(app, file);
    await tid(page, 'runway-import-markdown').click();
    const dialog = tid(page, 'runway-markdown-import');
    const groups = dialog.locator('[data-testid="import-group"]');
    const named = (name: string) => groups.filter({ has: page.locator('[data-testid="import-group-name"]', { hasText: name }) });
    const names = () => groups.locator('[data-testid="import-group-name"]').allTextContents();
    const numbers = (name: string) =>
      named(name).locator('[data-testid="import-row"][data-kind="ticket"]').evaluateAll((els) => els.map((e) => `${e.querySelector('[data-testid="import-row-number"]')?.textContent} ${e.getAttribute('data-key')} L${e.getAttribute('data-line')}`));

    await expect(groups).toHaveCount(3);
    await expect.poll(() => numbers('Reader plan')).toEqual(['#1 READ-12 L2', '#2 READ-14 L3', '#3 READ-20 L8']);
    await expect(tid(page, 'import-undo')).toBeDisabled();

    // Tick READ-9: scheduled at line 5, after the paragraph; READ-20 moves to #4.
    const read9 = named('Reader plan').locator('[data-testid="import-reference"][data-text="READ-9"]');
    await expect(read9).toHaveAttribute('data-status', 'matched');
    await read9.locator('[data-testid="import-reference-tick"]').check();
    await expect.poll(() => numbers('Reader plan')).toEqual(['#1 READ-12 L2', '#2 READ-14 L3', '#3 READ-9 L5', '#4 READ-20 L8']);
    await expect(read9).toContainText('Scheduled as #3');

    // Split "### Later" into its own workspace, right after its parent.
    await named('Reader plan').locator('[data-testid="import-row"][data-kind="section"][data-line="7"] [data-testid="import-split"]').click();
    await expect.poll(names).toEqual(['Reader plan', 'Later', 'Sync work', 'Notes to drop']);
    await expect.poll(() => numbers('Later')).toEqual(['#1 READ-20 L8']);
    await expect.poll(() => numbers('Reader plan')).toEqual(['#1 READ-12 L2', '#2 READ-14 L3', '#3 READ-9 L5']);

    // Rename "Later" to the active workspace's name: Map to workspace is offered, and only applies when chosen.
    await named('Later').locator('[data-testid="import-rename"]').click();
    // The heading becomes the name field while renaming, so the group is found by position.
    await groups.nth(1).locator('[data-testid="import-rename-input"]').fill(activeName.toUpperCase());
    await groups.nth(1).locator('[data-testid="import-rename-save"]').click();
    const renamed = groups.nth(1);
    await expect(renamed.locator('[data-testid="import-group-name"]')).toHaveText(activeName.toUpperCase());
    await expect(renamed.locator('[data-testid="import-group-target"]')).toHaveAttribute('data-kind', 'new');
    await renamed.locator('[data-testid="import-collision-map"]').click();
    await expect(renamed.locator('[data-testid="import-group-target"]')).toHaveAttribute('data-kind', 'existing');
    await expect(renamed.locator('[data-testid="import-group-name"]')).toHaveText(activeName);
    await expect(renamed.locator('[data-testid="import-rename"]')).toHaveCount(0);

    // Merge "Sync work" into "Reader plan": its heading stays as a section at the join.
    await named('Sync work').locator('[data-testid="import-merge"]').selectOption({ label: 'Reader plan (line 1)' });
    await expect.poll(names).toEqual(['Reader plan', activeName, 'Notes to drop']);
    await expect.poll(() => numbers('Reader plan')).toEqual(['#1 READ-12 L2', '#2 READ-14 L3', '#3 READ-9 L5', '#4 SYNC-3 L11']);
    await expect(named('Reader plan').locator('[data-testid="import-row"][data-kind="section"][data-join="true"] [data-testid="import-section-text"]')).toHaveText('Sync work');

    // Skip "Notes to drop", then Undo brings it back.
    await named('Notes to drop').locator('[data-testid="import-skip"]').click();
    await expect(named('Notes to drop')).toHaveAttribute('data-skipped', 'true');
    await expect(named('Notes to drop').locator('[data-testid="import-row"]')).toHaveCount(0);
    await tid(page, 'import-undo').click();
    await expect(named('Notes to drop')).not.toHaveAttribute('data-skipped', 'true');

    // Reset: the preview as first opened.
    await tid(page, 'import-reset').click();
    await expect.poll(names).toEqual(['Reader plan', 'Sync work', 'Notes to drop']);
    await expect.poll(() => numbers('Reader plan')).toEqual(['#1 READ-12 L2', '#2 READ-14 L3', '#3 READ-20 L8']);
    await expect(read9.locator('[data-testid="import-reference-tick"]')).not.toBeChecked();
    await expect(tid(page, 'import-undo')).toBeDisabled();

    // Cancel: nothing was written.
    await tid(page, 'import-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(await baseline(page, userDataDir)).toEqual(before);
  });
});

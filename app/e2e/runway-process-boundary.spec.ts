/**
 * The Runway, sort and import boundary (VERM-106, spec e2e 14), in the
 * packaged app: Runway, sort and import actions never start an agent, never
 * send input to tmux and never invoke ConTower, while a workspace whose
 * tracker credential comes from a shell command still reads its tickets.
 *
 * The main process's e2e recorder (main/e2eProcessRecorder.ts) sees every
 * process launch and every openPath/openExternal call. The only one allowed
 * is the configured credential command, matched exactly by its SHA-256 (the
 * recorder never keeps command text). The fake YouTrack accepts ticket reads
 * only with the token that command prints and counts them, so the credential
 * is proved to have worked during the test, not served from a cache.
 *
 * Each step waits for its action to finish, then checks every launch since
 * the previous step. e2e/COVERAGE.md maps each handler to its step.
 * Synthetic keys, names and hosts only.
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const TOKEN = 'e2e-command-token-verm106';
const COMMAND = `printf %s ${TOKEN}`;
const COMMAND_SHA = createHash('sha256').update(COMMAND).digest('hex');
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const WS_A = 'ws-e2ea106';
const WS_B = 'ws-e2eb106';

const EXAMPLE = ['## Ship the offline reader', '', 'Readers lose their place on the train.', '', '- [ ] READ-14 - Sync read state', '- [ ] SYNC-3 - Merge library', '', '### Later', '', 'Look again.', ''].join('\n');

function scratchFile(name: string, content: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verm106-')), name);
  fs.writeFileSync(p, content);
  return p;
}

async function stubDialogs(app: ElectronApplication, open: string, save: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, [o, s]) => {
      (dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [o] });
      (dialog as unknown as { showSaveDialog: () => Promise<unknown> }).showSaveDialog = async () => ({ canceled: false, filePath: s });
    },
    [open, save],
  );
}

const launches = (page: Page) => page.evaluate(async () => (await window.vermilian.debugGetProcessLaunches?.()) ?? []);
const tokenReads = (page: Page) => page.evaluate(async () => (await window.vermilian.debugGetRequiredTokenReads?.()) ?? -1);

/** Runs each step, then checks that every launch since the last step was the credential command. */
function stepper(page: Page) {
  let seen = 0;
  return {
    async mark() {
      seen = (await launches(page)).length;
    },
    async step(name: string, action: () => Promise<unknown>) {
      await action();
      const all = await launches(page);
      const fresh = all.slice(seen);
      seen = all.length;
      for (const l of fresh) {
        expect({ step: name, kind: l.kind, program: l.program, sha256: l.sha256 }, `step "${name}" launched something other than the credential command`).toEqual({
          step: name,
          kind: 'exec',
          program: 'printf',
          sha256: COMMAND_SHA,
        });
      }
      return fresh.length;
    },
  };
}

const ok = (r: { ok: boolean }, what: string) => expect(r.ok, `${what}: ${JSON.stringify(r)}`).toBe(true);

test.describe('Runway, sort and import start no agent, send nothing to tmux and never invoke ConTower (VERM-106)', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('only the shell-command credential runs, and it reads the tickets, across every Runway, sort and import handler', async () => {
    test.setTimeout(120_000);
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, {
      VERMILIAN_E2E_YT_RUNWAY_FIXTURES: '1',
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_YT_REQUIRE_TOKEN: TOKEN,
    });
    let page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });

    // ── Setup: two workspaces whose YouTrack credential comes from a shell command.
    ok(await page.evaluate((c) => window.vermilian.setCredentialRefSources('youtrack-cmd', { command: c, file: '' }), COMMAND), 'credential source');
    const doc = (workspaceId: string, name: string, order: number): WorkspaceDocument => ({
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId,
      name,
      order,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-cmd' },
      ai: { credentialRef: null },
      folders: [{ id: `folder-${order}`, name: 'Projects', order: 0, parentId: null, projectIds: [] }],
      boards: {},
      dismissals: {},
    });
    for (const d of [doc(WS_A, 'Workspace A', 0), doc(WS_B, 'Workspace B', 1)]) ok(await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d), `create ${d.name}`);
    await page.reload();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    if ((await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId !== WS_A) {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Workspace A' }).click();
    }
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId).toBe(WS_A);
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();
    const s = stepper(page);

    // ── 1. The credential works during the test: a fresh read, with the command's token.
    await s.mark();
    const readsBefore = await tokenReads(page);
    // READ-12 is added from the Runway's own Add box, which reads it and refreshes the view.
    let resolved: Awaited<ReturnType<typeof window.vermilian.runwayItemsResolve>> | undefined;
    const ran = await s.step('fresh ticket read (Add box, then runwayItemsResolve)', async () => {
      await tid(page, 'runway-add-input').fill('READ-12');
      await tid(page, 'runway-add-submit').click();
      await expect(tid(page, 'runway-view')).toContainText('Cache articles locally');
      resolved = await page.evaluate((w) => window.vermilian.runwayItemsResolve({ workspaceId: w }), WS_A);
    });
    expect(ran, 'the credential command ran during the read').toBeGreaterThanOrEqual(1);
    expect(await tokenReads(page), 'the tracker accepted reads made with the command’s token').toBeGreaterThan(readsBefore);
    expect(resolved?.ok && resolved.tickets.find((t) => t.itemId === 'yt:READ-12')).toMatchObject({ state: 'resolved', issue: { summary: 'Cache articles locally' } });

    // ── 2. Every Runway handler.
    const call = async (name: string, fn: (w: string) => Promise<{ ok: boolean }>) => {
      await s.step(name, async () => ok(await page.evaluate(fn, WS_A), name));
    };
    await s.step('runwayItemsList', () => page.evaluate((w) => window.vermilian.runwayItemsList({ workspaceId: w }), WS_A));
    await call('runwayItemsAddIssueAtNumber', (w) => window.vermilian.runwayItemsAddIssueAtNumber({ workspaceId: w, issueId: 'yt:SYNC-7', runwayNumber: 1 }));
    await call('runwayItemsAddSection', (w) => window.vermilian.runwayItemsAddSection({ workspaceId: w, text: 'Later' }));
    await call('runwayItemsAddNote', (w) => window.vermilian.runwayItemsAddNote({ workspaceId: w, text: 'A note' }));
    await call('runwayItemsMoveToNumber', (w) => window.vermilian.runwayItemsMoveToNumber({ workspaceId: w, itemId: 'yt:READ-12', runwayNumber: 1 }));
    await call('runwayItemsMoveUp', (w) => window.vermilian.runwayItemsMoveUp({ workspaceId: w, itemId: 'yt:SYNC-7' }));
    await call('runwayItemsMoveDown', (w) => window.vermilian.runwayItemsMoveDown({ workspaceId: w, itemId: 'yt:SYNC-7' }));
    const noteId = await page.evaluate(async (w) => {
      const r = await window.vermilian.runwayItemsList({ workspaceId: w });
      return r.ok ? (r.items.find((i) => i.kind === 'note')?.itemId ?? '') : '';
    }, WS_A);
    await s.step('runwayItemsMove', async () => ok(await page.evaluate(([w, id]) => window.vermilian.runwayItemsMove({ workspaceId: w, itemId: id, position: 1 }), [WS_A, noteId] as const), 'move'));
    // The blocker actions: Add to Runway puts PLAT-40 above SYNC-7, which depends on it; Move prerequisite above.
    await call('runwayItemsAddIssueAbove (Add to Runway)', (w) =>
      window.vermilian.runwayItemsAddIssueAbove({ workspaceId: w, issueId: 'yt:PLAT-40', aliases: ['yt:PLAT-40'], dependentItemId: 'yt:SYNC-7' }),
    );
    await call('runwayItemsAddIssue', (w) => window.vermilian.runwayItemsAddIssue({ workspaceId: w, issueId: 'yt:SYNC-3' }));
    await call('runwayItemsMoveAbove (Move prerequisite above)', (w) => window.vermilian.runwayItemsMoveAbove({ workspaceId: w, itemId: 'yt:SYNC-3', dependentItemId: 'yt:READ-12' }));
    await call('runwayItemsAddByReference', (w) => window.vermilian.runwayItemsAddByReference({ workspaceId: w, reference: 'http://e2e.local/issue/READ-20' }));
    await s.step('runwayItemsRemove', async () => ok(await page.evaluate(([w, id]) => window.vermilian.runwayItemsRemove({ workspaceId: w, itemId: id }), [WS_A, noteId] as const), 'remove'));
    await s.step('runwayItemsResolve', async () => ok(await page.evaluate((w) => window.vermilian.runwayItemsResolve({ workspaceId: w }), WS_A), 'resolve'));

    // ── 3. Sorts: the priority read, and the All tasks sort control.
    await s.step('youtrackPriorityOrders', () => page.evaluate((w) => window.vermilian.youtrackPriorityOrders({ workspaceId: w, projectShortNames: ['READ', 'SYNC', 'PLAT'] }), WS_A));
    await s.step('All tasks sort: Runway #, Tracker priority, Ticket ID, direction, clear', async () => {
      await tid(page, 'nav-all-tasks').click();
      for (const key of ['runwayNumber', 'priority', 'ticketId']) {
        await tid(page, 'ws-sort-select').selectOption(key);
        await expect(tid(page, 'ws-sort-select')).toHaveValue(key);
      }
      await tid(page, 'ws-sort-direction').click();
      await tid(page, 'ws-sort-clear').click();
      await expect(tid(page, 'ws-sort-select')).toHaveValue('');
    });

    // ── 4. Markdown import: open, match, identify, Apply (new workspace), then a repeat-import Apply.
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();
    const snapshotFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verm106-snap-')), 'runway.vermilian-runway');
    await stubDialogs(app, scratchFile('schedule.md', EXAMPLE), snapshotFile);
    await s.step('runwayMarkdownOpen, runwayImportMatch, runwayMarkdownApply (new workspace)', async () => {
      await tid(page, 'runway-import-markdown').click();
      const dialog = tid(page, 'runway-markdown-import');
      await expect(tid(page, 'import-apply')).toBeEnabled();
      await tid(page, 'import-apply').click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    });
    await stubDialogs(app, scratchFile('again.md', EXAMPLE + '- [ ] READ-20 - Offline indicator\n'), snapshotFile);
    await s.step('runwayImportIdentify and runwayMarkdownApply (repeat import into a Runway with rows)', async () => {
      await tid(page, 'runway-import-markdown').click();
      const dialog = tid(page, 'runway-markdown-import');
      await expect(dialog.locator('[data-testid="import-row-placement"][data-state="new"]')).toHaveCount(1);
      await expect(tid(page, 'import-apply')).toBeEnabled();
      await tid(page, 'import-apply').click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    });
    await s.step('runwayImportMatch and runwayImportIdentify, called directly', async () => {
      const m = await page.evaluate((w) => window.vermilian.runwayImportMatch({ groups: [{ groupKey: 'g', workspaceId: w, candidates: [{ text: 'READ-14', line: 1, role: 'scheduled', reason: null }] }] }), WS_B);
      ok(m, 'match');
      ok(await page.evaluate((w) => window.vermilian.runwayImportIdentify({ workspaceId: w, itemIds: ['yt:READ-12'] }), WS_A), 'identify');
    });

    // ── 5. Snapshot export and import: export, preview, cancel, preview again, confirm.
    await s.step('runwayExportSnapshot', async () => ok(await page.evaluate(() => window.vermilian.runwayExportSnapshot()), 'export'));
    await stubDialogs(app, snapshotFile, snapshotFile);
    await s.step('runwayImportPreview and runwayImportCancel', async () => {
      const preview = await page.evaluate(() => window.vermilian.runwayImportPreview());
      ok(preview, 'preview');
      const token = preview.ok && 'preview' in preview ? preview.preview.token : '';
      await page.evaluate((t) => window.vermilian.runwayImportCancel({ token: t }), token);
    });
    await s.step('runwayImportPreview and runwayImportConfirm', async () => {
      const preview = await page.evaluate(() => window.vermilian.runwayImportPreview());
      ok(preview, 'preview');
      const token = preview.ok && 'preview' in preview ? preview.preview.token : '';
      ok(await page.evaluate((t) => window.vermilian.runwayImportConfirm({ token: t }), token), 'confirm');
    });

    // Nothing in the whole run was anything but the credential command.
    const all = await launches(page);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((l) => l.kind === 'openPath' || l.kind === 'openExternal')).toEqual([]);
    expect(all.filter((l) => /claude|tmux|contower/i.test(l.program))).toEqual([]);
  });
});

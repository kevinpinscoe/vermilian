/**
 * Runway snapshot import (VERM-51): Settings → Advanced → "Import Runway
 * snapshot…" previews a snapshot chosen in an open dialog, and on
 * confirmation backs up the live database into userData/runway-backups and
 * replaces it in one transaction, in the packaged app.
 *
 * Native dialogs are stubbed in the main process (app.evaluate). Snapshots
 * are produced by the app's own export (VERM-50). Everything runs against a
 * throwaway --user-data-dir; nothing is written to Jira or YouTrack.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  return page;
}

async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const stub = async () => ({ canceled: false, filePath: target });
    (dialog as unknown as { showSaveDialog: typeof stub }).showSaveDialog = stub;
  }, filePath);
}

// Replaces dialog.showOpenDialog in the main process. `null` means cancelled.
async function stubOpenDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const stub = async () => (target === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [target] });
    (dialog as unknown as { showOpenDialog: typeof stub }).showOpenDialog = stub;
  }, filePath);
}

type Write = [string, string, Record<string, unknown>];

async function write(page: Page, writes: Write[]): Promise<void> {
  for (const [workspaceId, issueId, patch] of writes) {
    const result = await page.evaluate(
      ([w, i, p]) => window.vermilian.runwayUpdate({ workspaceId: w, issueId: i, patch: p }),
      [workspaceId, issueId, patch] as const,
    );
    expect(result.ok).toBe(true);
  }
}

async function list(page: Page, workspaceId: string): Promise<Array<{ issueId: string; focusRank: number | null; whyNow: string | null }>> {
  const result = await page.evaluate((w) => window.vermilian.runwayList({ workspaceId: w }), workspaceId);
  if (!result.ok) throw new Error(result.error);
  return result.entries
    .map((e) => ({ issueId: e.issueId, focusRank: e.focusRank, whyNow: e.whyNow }))
    .sort((a, b) => a.issueId.localeCompare(b.issueId));
}

async function openAdvanced(page: Page): Promise<void> {
  await page.locator('[data-testid="topbar-settings-btn"]').click();
  await expect(page.getByRole('heading', { name: 'Advanced' })).toBeVisible();
}

// The "snapshot from the other machine": two workspaces, then exported.
const SNAPSHOT_STATE: Write[] = [
  ['workspace-default', 'jira:DEMO-101', { focusRank: 1, whyNow: 'Due Friday' }],
  ['workspace-default', 'jira:DEMO-102', { focus: true }],
  ['workspace-other', 'jira:DEMO-201', { focusRank: 2, whyNow: 'Other workspace' }],
];

test.describe('Runway snapshot import', () => {
  let app: ElectronApplication | undefined;
  let outDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-import-'));
    userDataDir = freshUserDataDir();
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  // Seeds SNAPSHOT_STATE, exports it, then changes live data so the import
  // has something to replace.
  async function prepare(page: Page, appRef: ElectronApplication): Promise<string> {
    await write(page, SNAPSHOT_STATE);
    const snapshot = path.join(outDir, 'snapshot.sqlite');
    await stubSaveDialog(appRef, snapshot);
    const exported = await page.evaluate(() => window.vermilian.runwayExportSnapshot());
    expect(exported.ok && !exported.canceled).toBe(true);
    // Diverge: drop DEMO-101's rank, add a live-only entry.
    await write(page, [
      ['workspace-default', 'jira:DEMO-101', { focusRank: null, whyNow: 'changed locally' }],
      ['workspace-default', 'jira:LIVE-1', { focusRank: 1, whyNow: 'live only' }],
    ]);
    return snapshot;
  }

  test('previews, backs up, and restores every workspace', async () => {
    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);
    const snapshot = await prepare(page, app);
    const beforeImport = await list(page, 'workspace-default');

    await stubOpenDialog(app, snapshot);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-import-btn"]').click();

    // The preview: destructive warning, honest timestamps, counts, backup dir.
    await expect(page.getByText('Replace all Runway metadata?')).toBeVisible();
    await expect(page.getByText('This replaces Runway data for every workspace')).toBeVisible();
    await expect(page.getByTestId('runway-import-export-time')).toHaveText('Not recorded in the snapshot');
    await expect(page.getByText('File last modified (file metadata, not the export time)')).toBeVisible();
    await expect(page.getByTestId('runway-import-schema')).toHaveText('1');
    await expect(page.getByTestId('runway-import-snapshot-counts')).toHaveText('3 entries, 0 dismissals');
    await expect(page.getByTestId('runway-import-live-counts')).toHaveText('4 entries, 0 dismissals');
    await expect(page.getByTestId('runway-import-backup-dir')).toHaveText(path.join(userDataDir, 'runway-backups'));

    await page.getByTestId('runway-import-confirm').click();
    await expect(page.getByText(/Imported Runway snapshot \(3 entries, 0 dismissals\)\. Previous data backed up to /)).toBeVisible();

    // Live data is the snapshot again, in both workspaces; LIVE-1 is gone.
    expect(await list(page, 'workspace-default')).toEqual([
      { issueId: 'jira:DEMO-101', focusRank: 1, whyNow: 'Due Friday' },
      { issueId: 'jira:DEMO-102', focusRank: null, whyNow: null },
    ]);
    expect(await list(page, 'workspace-other')).toEqual([
      { issueId: 'jira:DEMO-201', focusRank: 2, whyNow: 'Other workspace' },
    ]);

    // Exactly one automatic backup, holding the pre-import state.
    const backups = fs.readdirSync(path.join(userDataDir, 'runway-backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^runway-before-import-\d{8}-\d{6}\.sqlite$/);
    const backup = new DatabaseSync(path.join(userDataDir, 'runway-backups', backups[0]), { readOnly: true });
    try {
      const ids = backup
        .prepare(`SELECT issue_id FROM runway_entry WHERE workspace_id = 'workspace-default' ORDER BY issue_id`)
        .all()
        .map((r) => (r as { issue_id: string }).issue_id);
      expect(ids).toEqual(beforeImport.map((e) => e.issueId));
    } finally {
      backup.close();
    }
    // The staged private copy is gone.
    expect(fs.readdirSync(path.join(userDataDir, 'runway-import-staging'))).toEqual([]);

    // The live database keeps working after the import.
    await write(page, [['workspace-default', 'jira:DEMO-103', { focus: true }]]);
  });

  test('cancelling the preview changes nothing and writes no backup', async () => {
    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);
    const snapshot = await prepare(page, app);
    const before = await list(page, 'workspace-default');

    await stubOpenDialog(app, snapshot);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-import-btn"]').click();
    await expect(page.getByText('Replace all Runway metadata?')).toBeVisible();
    await page.getByTestId('runway-import-cancel').click();
    await expect(page.getByText('Replace all Runway metadata?')).toBeHidden();

    expect(await list(page, 'workspace-default')).toEqual(before);
    expect(fs.existsSync(path.join(userDataDir, 'runway-backups'))).toBe(false);
    // A cancelled preview cannot be confirmed later.
    const late = await page.evaluate(() => window.vermilian.runwayImportConfirm({ token: 'anything' }));
    expect(late).toMatchObject({ ok: false, code: 'no-preview' });
  });

  test('a file that is not a Runway snapshot is refused before any preview', async () => {
    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);
    await write(page, SNAPSHOT_STATE);
    const bogus = path.join(outDir, 'bogus.sqlite');
    fs.writeFileSync(bogus, 'this is not a database '.repeat(100));

    await stubOpenDialog(app, bogus);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-import-btn"]').click();
    await expect(page.getByText(/Runway snapshot not imported: This file is not an SQLite database/)).toBeVisible();
    await expect(page.getByText('Replace all Runway metadata?')).toBeHidden();
    expect(await list(page, 'workspace-default')).toHaveLength(2);
  });

  test('overlapping IPC requests cannot touch an active import or its staged snapshot', async () => {
    // Holds every confirmed import for 3 s between its backup and the
    // replacement (E2E-only hook), so the requests below overlap it.
    app = await launchAppWithUserDataDir(userDataDir, { VERMILIAN_E2E_RUNWAY_IMPORT_HOLD_MS: '3000' });
    const page = await ready(app);
    const snapshot = await prepare(page, app);
    const staging = path.join(userDataDir, 'runway-import-staging');
    const backupsDir = path.join(userDataDir, 'runway-backups');

    await stubOpenDialog(app, snapshot);
    const preview = await page.evaluate(() => window.vermilian.runwayImportPreview());
    if (!preview.ok || preview.canceled) throw new Error('preview failed');
    const token = preview.preview.token;
    const stagedFile = `${token}.sqlite`;
    expect(fs.readdirSync(staging)).toEqual([stagedFile]);

    // Confirm, without waiting: the import is now active and held.
    await page.evaluate((t) => {
      (window as unknown as { __import: Promise<unknown> }).__import = window.vermilian.runwayImportConfirm({ token: t });
    }, token);
    await expect.poll(() => (fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).length : 0)).toBe(1);

    // A second preview, a duplicate and a foreign confirmation, and a cancel —
    // all while the import is active.
    const second = path.join(outDir, 'second.sqlite');
    fs.copyFileSync(snapshot, second);
    await stubOpenDialog(app, second);
    const overlapping = await page.evaluate((t) => Promise.all([
      window.vermilian.runwayImportPreview(),
      window.vermilian.runwayImportConfirm({ token: t }),
      window.vermilian.runwayImportConfirm({ token: 'someone-else' }),
      window.vermilian.runwayImportCancel({ token: t }),
    ]), token);
    expect(overlapping[0]).toMatchObject({ ok: false, code: 'import-in-progress' });
    expect(overlapping[1]).toMatchObject({ ok: false, code: 'import-in-progress' });
    expect(overlapping[2]).toMatchObject({ ok: false, code: 'import-in-progress' });
    expect(overlapping[3]).toEqual({ ok: true });
    // The active import's staged snapshot is still there, untouched, alone.
    expect(fs.readdirSync(staging)).toEqual([stagedFile]);

    // Let the held import finish: it succeeds, and only then is staging cleaned.
    const result = await page.evaluate(() => (window as unknown as { __import: Promise<unknown> }).__import);
    expect(result).toMatchObject({ ok: true, result: { rowCounts: { runway_entry: 3, dismissal: 0 } } });
    expect(fs.readdirSync(staging)).toEqual([]);
    expect(await list(page, 'workspace-other')).toEqual([
      { issueId: 'jira:DEMO-201', focusRank: 2, whyNow: 'Other workspace' },
    ]);
    expect(fs.readdirSync(backupsDir)).toHaveLength(1);
    // Previews are accepted again afterwards.
    const after = await page.evaluate(() => window.vermilian.runwayImportPreview());
    expect(after).toMatchObject({ ok: true, canceled: false });
  });

  test('a snapshot changed after the preview is refused and live data is kept', async () => {
    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);
    const snapshot = await prepare(page, app);
    const before = await list(page, 'workspace-default');

    await stubOpenDialog(app, snapshot);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-import-btn"]').click();
    await expect(page.getByText('Replace all Runway metadata?')).toBeVisible();

    // Substitute the file's contents while the confirmation is open.
    const db = new DatabaseSync(snapshot);
    db.prepare(`UPDATE runway_entry SET why_now = 'substituted'`).run();
    db.close();

    await page.getByTestId('runway-import-confirm').click();
    await expect(page.getByText(/changed after it was previewed/)).toBeVisible();
    expect(await list(page, 'workspace-default')).toEqual(before);
    expect(fs.existsSync(path.join(userDataDir, 'runway-backups'))).toBe(false);
  });
});

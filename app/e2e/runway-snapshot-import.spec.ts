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

// A Runway database exactly as Vermilian v1 wrote it (schema v1, user_version 1).
const RUNWAY_SCHEMA_V1_DDL = `
CREATE TABLE runway_entry (
  workspace_id TEXT    NOT NULL CHECK (length(workspace_id) > 0),
  issue_id     TEXT    NOT NULL CHECK (length(issue_id) > 0),
  focus        INTEGER NOT NULL DEFAULT 0 CHECK (focus IN (0, 1)),
  focus_rank   INTEGER          CHECK (focus_rank BETWEEN 1 AND 3),
  why_now      TEXT,
  deferred     INTEGER NOT NULL DEFAULT 0 CHECK (deferred IN (0, 1)),
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (workspace_id, issue_id),
  CHECK (focus_rank IS NULL OR focus = 1)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX runway_entry_rank_unique
  ON runway_entry (workspace_id, focus_rank)
  WHERE focus_rank IS NOT NULL;

CREATE TABLE dismissal (
  workspace_id      TEXT NOT NULL CHECK (length(workspace_id) > 0),
  issue_id          TEXT NOT NULL CHECK (length(issue_id) > 0),
  dismissed_week_of TEXT NOT NULL CHECK (dismissed_week_of IS date(dismissed_week_of)),
  PRIMARY KEY (workspace_id, issue_id)
) STRICT, WITHOUT ROWID;
`;

function writeV1Database(file: string, fill: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(file);
  try {
    db.exec(RUNWAY_SCHEMA_V1_DDL);
    db.exec('PRAGMA application_id = 1448234316'); // 0x56524d4c, "VRML"
    db.exec('PRAGMA user_version = 1');
    fill(db);
  } finally {
    db.close();
  }
}

function insertV1Entry(db: DatabaseSync, workspace: string, issue: string, rank: number, whyNow: string | null): void {
  db.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
     VALUES (?, ?, 1, ?, ?, 0, '2026-01-05T09:00:00.000Z')`,
  ).run(workspace, issue, rank, whyNow);
}

// Where the preview screenshots for the PR go: VERMILIAN_E2E_EVIDENCE_DIR, or
// a throwaway temp directory.
function evidenceDir(): string {
  const dir = process.env.VERMILIAN_E2E_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-evidence-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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
    await expect(page.getByTestId('runway-import-exported-by')).toHaveText(os.hostname());
    await expect(page.getByTestId('runway-import-export-time')).not.toHaveText(/Not recorded/);
    await expect(page.getByText('File last modified (file metadata, not the export time)')).toBeVisible();
    await expect(page.getByTestId('runway-import-schema')).toHaveText('Version 2');
    await expect(page.getByTestId('runway-import-snapshot-counts')).toHaveText('3 entries, 0 dismissals; Runway order empty');
    await expect(page.getByTestId('runway-import-live-counts')).toHaveText('4 entries, 0 dismissals; Runway order empty');
    // prepare() changed live data after the export, so the preview warns first.
    await expect(page.getByTestId('runway-import-replace-warning')).toContainText(
      'This computer has Runway changes newer than this snapshot.',
    );
    await expect(page.getByTestId('runway-import-backup-dir')).toHaveText(path.join(userDataDir, 'runway-backups'));

    await page.getByTestId('runway-import-confirm').click();
    await expect(page.getByText(/Imported Runway snapshot \(3 entries, 0 dismissals; Runway order empty\)\. Previous data backed up to /)).toBeVisible();

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
    expect(result).toMatchObject({ ok: true, result: { rowCounts: { runway_entry: 3, dismissal: 0, runway_item: 0 } } });
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
  // ─── VERM-78 / VERM-79 ────────────────────────────────────────────────────

  test('migrates a live v1 database, then imports a v1 snapshot with the cannot-tell warning', async () => {
    // This computer still has a version 1 Runway database (written by an
    // older Vermilian), holding a Desk entry and a dismissal.
    const livePath = path.join(userDataDir, 'runway-metadata.sqlite');
    writeV1Database(livePath, (db) => {
      insertV1Entry(db, 'workspace-default', 'jira:LOCAL-1', 1, 'local v1 entry');
      db.prepare('INSERT INTO dismissal (workspace_id, issue_id, dismissed_week_of) VALUES (?, ?, ?)').run(
        'workspace-default',
        'jira:LOCAL-2',
        '2026-01-05',
      );
    });
    // An existing version 1 snapshot from another computer.
    const snapshot = path.join(outDir, 'v1-snapshot.sqlite');
    writeV1Database(snapshot, (db) => {
      insertV1Entry(db, 'workspace-default', 'jira:DEMO-101', 1, 'From the v1 snapshot');
      insertV1Entry(db, 'workspace-other', 'jira:DEMO-201', 2, null);
    });
    const snapshotBytes = fs.readFileSync(snapshot);

    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);

    // First use migrates the live file to v2, keeping its rows, after a copy.
    expect(await list(page, 'workspace-default')).toEqual([
      { issueId: 'jira:LOCAL-1', focusRank: 1, whyNow: 'local v1 entry' },
    ]);
    const preMigration = fs.readdirSync(path.join(userDataDir, 'runway-backups'));
    expect(preMigration).toHaveLength(1);
    expect(preMigration[0]).toMatch(/^runway-pre-v2-migration-\d{8}-\d{6}\.sqlite$/);
    const copy = new DatabaseSync(path.join(userDataDir, 'runway-backups', preMigration[0]), { readOnly: true });
    try {
      expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
      expect(copy.prepare('SELECT issue_id, why_now FROM runway_entry').all()).toEqual([
        { issue_id: 'jira:LOCAL-1', why_now: 'local v1 entry' },
      ]);
      expect(copy.prepare('SELECT issue_id FROM dismissal').all()).toEqual([{ issue_id: 'jira:LOCAL-2' }]);
    } finally {
      copy.close();
    }

    await stubOpenDialog(app, snapshot);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-import-btn"]').click();
    await expect(page.getByTestId('runway-import-schema')).toHaveText(
      'Version 1 — will be upgraded to version 2 on import. The upgrade happens in the staging copy, never in the live database.',
    );
    await expect(page.getByTestId('runway-import-exported-by')).toHaveText('Not recorded (version 1 snapshot)');
    await expect(page.getByTestId('runway-import-export-time')).toHaveText('Not recorded (version 1 snapshot)');
    await expect(page.getByTestId('runway-import-snapshot-counts')).toHaveText(
      '2 entries, 0 dismissals; Runway order empty (version 1 has no Runway order)',
    );
    await expect(page.getByTestId('runway-import-replace-warning')).toContainText(
      'This snapshot does not record when it was exported, so Vermilian cannot tell whether this computer has ' +
        'newer Runway changes. Importing replaces all local Runway data.',
    );
    await page.screenshot({ path: path.join(evidenceDir(), 'v1-snapshot-preview.png') });
    await page
      .getByTestId('runway-import-replace-warning')
      .screenshot({ path: path.join(evidenceDir(), 'v1-snapshot-warning.png') });

    await page.getByTestId('runway-import-confirm').click();
    await expect(page.getByText(/Imported Runway snapshot \(2 entries, 0 dismissals; Runway order empty\)/)).toBeVisible();
    expect(await list(page, 'workspace-default')).toEqual([
      { issueId: 'jira:DEMO-101', focusRank: 1, whyNow: 'From the v1 snapshot' },
    ]);
    expect(await list(page, 'workspace-other')).toEqual([{ issueId: 'jira:DEMO-201', focusRank: 2, whyNow: null }]);
    // The chosen v1 file was never modified.
    expect(fs.readFileSync(snapshot).equals(snapshotBytes)).toBe(true);
    // A pre-import backup was written beside the pre-migration copy.
    expect(fs.readdirSync(path.join(userDataDir, 'runway-backups')).filter((n) => n.startsWith('runway-before-import-'))).toHaveLength(1);
  });

  test('restores a populated v2 snapshot from another computer, warning first about newer local changes', async () => {
    // "The other computer": Desk data plus a Runway order, then exported.
    const otherDir = freshUserDataDir();
    try {
      app = await launchAppWithUserDataDir(otherDir);
      let page = await ready(app);
      await write(page, SNAPSHOT_STATE);
      await app.close();
      // No Runway order write path exists yet (VERM-80), so the order is
      // written straight into that computer's database while it is closed.
      const otherDb = new DatabaseSync(path.join(otherDir, 'runway-metadata.sqlite'));
      try {
        const item = otherDb.prepare(
          `INSERT INTO runway_item (workspace_id, item_id, kind, position, depth, text, added_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const at = '2026-01-05T09:00:00.000Z';
        item.run('workspace-default', 'yt:DEMO-7', 'issue', 1, 0, null, at, at);
        item.run('workspace-default', 'sec:00000000-0000-4000-8000-000000000001', 'section', 2, 0, 'Later', at, at);
        item.run('workspace-default', 'note:00000000-0000-4000-8000-000000000002', 'note', 3, 1, 'Ask about it', at, at);
        item.run('workspace-default', 'jira:DEMO-101', 'issue', 4, 1, null, at, at);
        item.run('workspace-other', 'jira:DEMO-201', 'issue', 1, 0, null, at, at);
      } finally {
        otherDb.close();
      }
      app = await launchAppWithUserDataDir(otherDir);
      page = await ready(app);
      const snapshot = path.join(outDir, 'v2-snapshot.sqlite');
      await stubSaveDialog(app, snapshot);
      const exported = await page.evaluate(() => window.vermilian.runwayExportSnapshot());
      expect(exported).toMatchObject({ ok: true, canceled: false, snapshot: { schemaVersion: 2, exportedBy: os.hostname() } });
      await app.close();
      app = undefined;

      // "This computer": a Desk change made after that export.
      app = await launchAppWithUserDataDir(userDataDir);
      page = await ready(app);
      await write(page, [['workspace-default', 'jira:LOCAL-1', { focusRank: 1, whyNow: 'made after the export' }]]);

      await stubOpenDialog(app, snapshot);
      await openAdvanced(page);
      await page.locator('[data-testid="runway-import-btn"]').click();
      await expect(page.getByTestId('runway-import-schema')).toHaveText('Version 2');
      await expect(page.getByTestId('runway-import-exported-by')).toHaveText(os.hostname());
      await expect(page.getByTestId('runway-import-export-time')).not.toHaveText(/Not recorded/);
      await expect(page.getByTestId('runway-import-snapshot-counts')).toHaveText('3 entries, 0 dismissals; Runway order 5 rows');
      await expect(page.getByTestId('runway-import-replace-warning')).toContainText(
        'The latest is the Priority Desk entry for jira:LOCAL-1 in workspace workspace-default',
      );
      await page.screenshot({ path: path.join(evidenceDir(), 'v2-snapshot-preview.png') });
      await page
        .getByTestId('runway-import-replace-warning')
        .screenshot({ path: path.join(evidenceDir(), 'v2-snapshot-warning.png') });

      await page.getByTestId('runway-import-confirm').click();
      await expect(page.getByText(/Imported Runway snapshot \(3 entries, 0 dismissals; Runway order 5 rows\)/)).toBeVisible();
      expect(await list(page, 'workspace-default')).toEqual([
        { issueId: 'jira:DEMO-101', focusRank: 1, whyNow: 'Due Friday' },
        { issueId: 'jira:DEMO-102', focusRank: null, whyNow: null },
      ]);
      await app.close();
      app = undefined;

      // The restored Runway order is exactly the other computer's.
      const order = (file: string) => {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          return db.prepare('SELECT * FROM runway_item ORDER BY workspace_id, position').all();
        } finally {
          db.close();
        }
      };
      const restored = order(path.join(userDataDir, 'runway-metadata.sqlite'));
      expect(restored).toHaveLength(5);
      expect(restored).toEqual(order(path.join(otherDir, 'runway-metadata.sqlite')));
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

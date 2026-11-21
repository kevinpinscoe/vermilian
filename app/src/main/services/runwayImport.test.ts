import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_V1, openRunwayDb } from './runwayDb';
import {
  RUNWAY_BACKUP_KEEP,
  RunwayImportError,
  RunwayWriteGate,
  backupFileName,
  clearRunwayImportStaging,
  discardStagedSnapshot,
  importRunwaySnapshot,
  inspectRunwaySnapshot,
  latestLocalRunwayChange,
  pruneRunwayBackups,
  runwayFingerprint,
  runwayImportWarning,
  runwayImportWarnings,
  stageRunwaySnapshot,
} from './runwayImport';
import { exportRunwaySnapshot, runwayRowCounts } from './runwaySnapshot';

let dir: string; // userData stand-in: live db, staging, backups
let outDir: string; // where "the user" keeps snapshot files
let live: DatabaseSync;
let staging: string;
let backups: string;

const NOW = '2026-01-05T09:00:00.000Z';
const FIXED = new Date(2026, 0, 5, 9, 30, 15);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vermilian-import-test-'));
  outDir = mkdtempSync(join(tmpdir(), 'vermilian-import-out-'));
  live = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  staging = join(dir, 'runway-import-staging');
  backups = join(dir, 'runway-backups');
});

afterEach(() => {
  live.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

type Row = [string, string, number, number | null, string | null, number];

function insertEntries(db: DatabaseSync, rows: Row[]): void {
  const stmt = db.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) stmt.run(...r, NOW);
}

function insertDismissal(db: DatabaseSync, ws: string, id: string, week: string): void {
  db.prepare('INSERT INTO dismissal (workspace_id, issue_id, dismissed_week_of) VALUES (?, ?, ?)').run(ws, id, week);
}

function rows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY workspace_id, issue_id`).all();
}

// The live state before an import: workspace A only.
function seedLive(): void {
  insertEntries(live, [
    ['ws-a', 'jira:LIVE-1', 1, 1, 'live only', 0],
    ['ws-a', 'jira:LIVE-2', 1, null, null, 0],
  ]);
  insertDismissal(live, 'ws-a', 'jira:LIVE-3', '2026-01-05');
}

// A snapshot from "another machine": two workspaces, records absent from live.
async function makeSnapshot(name = 'snapshot.sqlite'): Promise<string> {
  const otherDir = mkdtempSync(join(tmpdir(), 'vermilian-import-other-'));
  const other = openRunwayDb(join(otherDir, 'runway-metadata.sqlite'));
  try {
    insertEntries(other, [
      ['ws-a', 'jira:DEMO-1', 1, 1, 'Due Friday', 0],
      ['ws-a', 'jira:DEMO-2', 1, 2, null, 0],
      ['ws-b', 'jira:DEMO-1', 1, 1, 'Other workspace', 0],
      ['ws-b', 'jira:DEMO-9', 0, null, 'kept why now', 1],
    ]);
    insertDismissal(other, 'ws-b', 'jira:DEMO-5', '2026-01-05');
    const dest = join(outDir, name);
    await exportRunwaySnapshot(other, dest);
    return dest;
  } finally {
    other.close();
    rmSync(otherDir, { recursive: true, force: true });
  }
}

// Builds a snapshot file by hand, to forge broken ones.
function rawSnapshot(name: string, build: (db: DatabaseSync) => void): string {
  const path = join(outDir, name);
  const db = new DatabaseSync(path);
  try {
    build(db);
  } finally {
    db.close();
  }
  return path;
}

async function expectCode(promise: Promise<unknown> | (() => unknown), code: string): Promise<RunwayImportError> {
  try {
    if (typeof promise === 'function') promise();
    else await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(RunwayImportError);
    expect((err as RunwayImportError).code).toBe(code);
    return err as RunwayImportError;
  }
  throw new Error(`expected RunwayImportError ${code}`);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RunwayImportError);
    return (err as RunwayImportError).code;
  }
  throw new Error('expected a RunwayImportError');
}

function importOptions(extra: Partial<Parameters<typeof importRunwaySnapshot>[2]> = {}) {
  return { backupDir: backups, now: () => FIXED, ...extra };
}

describe('stageRunwaySnapshot / inspectRunwaySnapshot', () => {
  it('stages a valid snapshot with its counts, schema and file metadata', async () => {
    const src = await makeSnapshot();
    const mtime = new Date('2025-12-31T23:00:00.000Z');
    utimesSync(src, mtime, mtime);
    const staged = stageRunwaySnapshot(src, staging);
    expect(staged.schemaVersion).toBe(2);
    expect(staged.originalSchemaVersion).toBe(2);
    expect(staged.rowCounts).toEqual({ runway_entry: 4, dismissal: 1, runway_item: 0 });
    // File metadata only: it is reported as the file's mtime, never as an export time.
    expect(staged.fileModifiedAt).toBe(mtime.toISOString());
    // The export time is the one the snapshot records, not the file's mtime.
    expect(staged.exportedBy).toEqual(expect.any(String));
    expect(staged.exportedAt).not.toBe(mtime.toISOString());
    expect(Number.isNaN(Date.parse(staged.exportedAt ?? ''))).toBe(false);
    expect(staged.stagedPath.startsWith(staging)).toBe(true);
    expect(readFileSync(staged.stagedPath)).toEqual(readFileSync(src));
    // The chosen file is never opened by SQLite: no side files appear beside it.
    expect(readdirSync(outDir)).toEqual(['snapshot.sqlite']);
  });

  it('refuses a relative path, a directory and a missing file', async () => {
    await expectCode(() => stageRunwaySnapshot('snapshot.sqlite', staging), 'invalid-source');
    await expectCode(() => stageRunwaySnapshot(outDir, staging), 'invalid-source');
    await expectCode(() => stageRunwaySnapshot(join(outDir, 'missing.sqlite'), staging), 'invalid-source');
  });

  it('refuses a file that is not SQLite and leaves no staged copy', async () => {
    const path = join(outDir, 'notes.sqlite');
    writeFileSync(path, 'just some text, not a database at all'.repeat(50));
    await expectCode(() => stageRunwaySnapshot(path, staging), 'not-a-database');
    expect(readdirSync(staging)).toEqual([]);
  });

  it('refuses a corrupt snapshot', async () => {
    const src = await makeSnapshot();
    const bytes = readFileSync(src);
    // Overwrite the b-tree page header of every page after the first with
    // garbage, so table data can no longer be read.
    const pageSize = bytes.readUInt16BE(16);
    for (let offset = pageSize; offset < bytes.length; offset += pageSize) bytes.fill(0xa5, offset, offset + 12);
    const corrupt = join(outDir, 'corrupt.sqlite');
    writeFileSync(corrupt, bytes);
    // Depending on which bytes SQLite reads first it reports either.
    expect(['integrity-failed', 'not-a-database']).toContain(codeOf(() => stageRunwaySnapshot(corrupt, staging)));
    expect(readdirSync(staging)).toEqual([]);
  });

  it('refuses a database with the wrong application_id', async () => {
    const path = rawSnapshot('foreign.sqlite', (db) => {
      db.exec('CREATE TABLE notes (body TEXT)');
      db.exec('PRAGMA application_id = 1234');
      db.exec('PRAGMA user_version = 1');
    });
    await expectCode(() => stageRunwaySnapshot(path, staging), 'foreign-database');
  });

  it('refuses a newer schema version', async () => {
    const src = await makeSnapshot();
    const db = new DatabaseSync(src);
    db.exec('PRAGMA user_version = 3');
    db.close();
    const err = await expectCode(() => stageRunwaySnapshot(src, staging), 'newer-schema');
    expect(err.message).toMatch(/newer/);
  });

  it('refuses a missing schema version', async () => {
    const path = rawSnapshot('v0.sqlite', (db) => {
      db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
      db.exec('CREATE TABLE runway_entry (x TEXT)');
    });
    await expectCode(() => stageRunwaySnapshot(path, staging), 'unsupported-schema');
  });

  it('refuses a schema that differs from this build (extra trigger, missing index)', async () => {
    const withTrigger = await makeSnapshot('trigger.sqlite');
    let db = new DatabaseSync(withTrigger);
    db.exec(`CREATE TRIGGER sneaky AFTER INSERT ON dismissal BEGIN DELETE FROM runway_entry; END`);
    db.close();
    const err = await expectCode(() => stageRunwaySnapshot(withTrigger, staging), 'schema-mismatch');
    expect(err.message).toMatch(/sneaky/);

    const noIndex = await makeSnapshot('noindex.sqlite');
    db = new DatabaseSync(noIndex);
    db.exec('DROP INDEX runway_entry_rank_unique');
    db.close();
    await expectCode(() => stageRunwaySnapshot(noIndex, staging), 'schema-mismatch');
  });

  it('refuses records that break Runway rules even if the file let them in', async () => {
    // A non-Jira issue ID.
    const yt = await makeSnapshot('yt.sqlite');
    let db = new DatabaseSync(yt);
    insertEntries(db, [['ws-a', 'yt:2-17', 1, null, null, 0]]);
    db.close();
    await expectCode(() => stageRunwaySnapshot(yt, staging), 'invalid-data');

    // A rank without Focus, written with CHECK constraints switched off.
    const bad = await makeSnapshot('bad-rank.sqlite');
    db = new DatabaseSync(bad);
    db.exec('PRAGMA ignore_check_constraints = ON');
    insertEntries(db, [['ws-a', 'jira:DEMO-77', 0, 3, null, 0]]);
    db.close();
    // integrity_check may already catch the broken CHECK; the dry run does otherwise.
    expect(['invalid-data', 'integrity-failed']).toContain(codeOf(() => stageRunwaySnapshot(bad, staging)));
    expect(readdirSync(staging)).toEqual([]);
  });

  it('inspects without writing to the file', async () => {
    const src = await makeSnapshot();
    const before = readFileSync(src);
    inspectRunwaySnapshot(src);
    expect(readFileSync(src)).toEqual(before);
  });
});

describe('importRunwaySnapshot', () => {
  it('replaces every table and workspace, including records absent from live', async () => {
    seedLive();
    const src = await makeSnapshot();
    const staged = stageRunwaySnapshot(src, staging);
    const result = await importRunwaySnapshot(live, staged, importOptions());

    const snap = new DatabaseSync(src, { readOnly: true });
    try {
      expect(rows(live, 'runway_entry')).toEqual(rows(snap, 'runway_entry'));
      expect(rows(live, 'dismissal')).toEqual(rows(snap, 'dismissal'));
    } finally {
      snap.close();
    }
    expect(rows(live, 'runway_entry').some((r) => (r as { issue_id: string }).issue_id === 'jira:LIVE-1')).toBe(false);
    expect(result.rowCounts).toEqual({ runway_entry: 4, dismissal: 1, runway_item: 0 });
    expect(result.previousRowCounts).toEqual({ runway_entry: 2, dismissal: 1, runway_item: 0 });
    expect(result.backupPath).toBe(join(backups, backupFileName(FIXED)));
    expect(result.pruneWarning).toBeUndefined();
    // The live database is still the same, usable file and connection.
    expect(live.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    insertEntries(live, [['ws-c', 'jira:NEW-1', 1, 1, null, 0]]);
  });

  it('writes a backup of the complete pre-import database that the import can restore', async () => {
    seedLive();
    const before = { entries: rows(live, 'runway_entry'), dismissals: rows(live, 'dismissal') };
    const fingerprintBefore = runwayFingerprint(live);
    const result = await importRunwaySnapshot(live, stageRunwaySnapshot(await makeSnapshot(), staging), importOptions());

    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      expect(rows(backup, 'runway_entry')).toEqual(before.entries);
      expect(rows(backup, 'dismissal')).toEqual(before.dismissals);
    } finally {
      backup.close();
    }

    // Restoring that backup through the same import puts live back exactly.
    const later = new Date(FIXED.getTime() + 60_000);
    await importRunwaySnapshot(live, stageRunwaySnapshot(result.backupPath, staging), importOptions({ now: () => later }));
    expect(runwayFingerprint(live)).toBe(fingerprintBefore);
    expect(rows(live, 'runway_entry')).toEqual(before.entries);
  });

  it('a failed backup prevents the import and changes nothing', async () => {
    seedLive();
    const fingerprint = runwayFingerprint(live);
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const err = await expectCode(
      importRunwaySnapshot(live, staged, importOptions({ exportSnapshot: async () => { throw new Error('disk full'); } })),
      'backup-failed',
    );
    expect(err.message).toMatch(/Nothing was imported/);
    expect(runwayFingerprint(live)).toBe(fingerprint);
  });

  it('a failure halfway through the replacement leaves every live record unchanged', async () => {
    seedLive();
    const before = { entries: rows(live, 'runway_entry'), dismissals: rows(live, 'dismissal') };
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const err = await expectCode(
      importRunwaySnapshot(live, staged, importOptions({ hooks: { afterDelete: () => { throw new Error('power cut'); } } })),
      'import-failed',
    );
    expect(err.backupPath).toBeDefined();
    expect(rows(live, 'runway_entry')).toEqual(before.entries);
    expect(rows(live, 'dismissal')).toEqual(before.dismissals);
    // Not left in a transaction or with the snapshot attached.
    expect(live.prepare('PRAGMA database_list').all()).toHaveLength(1);
    insertEntries(live, [['ws-c', 'jira:NEW-1', 1, null, null, 0]]);
  });

  it('invalid records cannot bypass the live constraints during the replacement', async () => {
    seedLive();
    const before = { entries: rows(live, 'runway_entry'), dismissals: rows(live, 'dismissal') };
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    // Tamper with the staged copy AFTER revalidation (between backup and
    // replace): give two issues in one workspace the same rank. Only the live
    // database's own unique index stands in the way now.
    const tamper = () => {
      const db = new DatabaseSync(staged.stagedPath);
      db.exec('DROP INDEX runway_entry_rank_unique');
      db.prepare(`UPDATE runway_entry SET focus_rank = 1 WHERE issue_id = 'jira:DEMO-2' AND workspace_id = 'ws-a'`).run();
      db.close();
    };
    const err = await expectCode(importRunwaySnapshot(live, staged, importOptions({ hooks: { afterBackup: tamper } })), 'import-failed');
    expect(err.message).toMatch(/UNIQUE constraint failed/);
    expect(rows(live, 'runway_entry')).toEqual(before.entries);
    expect(rows(live, 'dismissal')).toEqual(before.dismissals);
  });

  it('detects the chosen file being replaced between preview and confirmation', async () => {
    seedLive();
    const fingerprint = runwayFingerprint(live);
    const src = await makeSnapshot();
    const staged = stageRunwaySnapshot(src, staging);
    // Substitute a different, equally valid snapshot at the same path.
    rmSync(src);
    await makeSnapshot('snapshot.sqlite');
    const db = new DatabaseSync(src);
    db.prepare(`UPDATE runway_entry SET why_now = 'substituted' WHERE issue_id = 'jira:DEMO-1'`).run();
    db.close();
    await expectCode(importRunwaySnapshot(live, staged, importOptions()), 'snapshot-changed');
    expect(runwayFingerprint(live)).toBe(fingerprint);
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual([]);
  });

  it('detects the chosen file being removed after the preview', async () => {
    const src = await makeSnapshot();
    const staged = stageRunwaySnapshot(src, staging);
    rmSync(src);
    await expectCode(importRunwaySnapshot(live, staged, importOptions()), 'snapshot-changed');
  });

  it('refuses when live data changes after the backup, so the backup is exactly what was replaced', async () => {
    seedLive();
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const err = await expectCode(
      importRunwaySnapshot(live, staged, importOptions({
        hooks: { afterBackup: () => insertEntries(live, [['ws-a', 'jira:RACE-1', 1, null, 'late', 0]]) },
      })),
      'live-changed',
    );
    expect(err.backupPath).toBeDefined();
    // The late write survives; nothing was replaced.
    expect(rows(live, 'runway_entry').map((r) => (r as { issue_id: string }).issue_id)).toContain('jira:RACE-1');
    expect(runwayRowCounts(live)).toEqual({ runway_entry: 3, dismissal: 1, runway_item: 0 });
  });

  it('reports busy and changes nothing when another connection holds the write lock', async () => {
    seedLive();
    const fingerprint = runwayFingerprint(live);
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const other = new DatabaseSync(join(dir, 'runway-metadata.sqlite'));
    try {
      const err = await expectCode(
        importRunwaySnapshot(live, staged, importOptions({ hooks: { afterBackup: () => { other.exec('BEGIN IMMEDIATE'); } } })),
        'busy',
      );
      expect(err.message).toMatch(/busy/);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(runwayFingerprint(live)).toBe(fingerprint);
    expect(live.prepare('PRAGMA database_list').all()).toHaveLength(1);
  });

  it('does not report success when post-import verification fails, and keeps the backup', async () => {
    seedLive();
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const err = await expectCode(
      importRunwaySnapshot(live, staged, importOptions({
        hooks: { afterCommit: () => insertEntries(live, [['ws-z', 'jira:ODD-1', 0, null, null, 0]]) },
      })),
      'verification-failed',
    );
    expect(err.backupPath).toBeDefined();
    expect(existsSync(err.backupPath as string)).toBe(true);
    expect(err.message).toMatch(/Import Runway snapshot/);
  });

  it('gives same-second backups unique names and never overwrites one', async () => {
    const staged1 = stageRunwaySnapshot(await makeSnapshot('a.sqlite'), staging);
    const r1 = await importRunwaySnapshot(live, staged1, importOptions());
    const staged2 = stageRunwaySnapshot(await makeSnapshot('b.sqlite'), staging);
    const r2 = await importRunwaySnapshot(live, staged2, importOptions());
    expect(r1.backupPath).toBe(join(backups, 'runway-before-import-20260105-093015.sqlite'));
    expect(r2.backupPath).toBe(join(backups, 'runway-before-import-20260105-093015-2.sqlite'));
  });

  it('a pruning failure is a warning, not a failed import', async () => {
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const result = await importRunwaySnapshot(live, staged, importOptions({
      pruneBackups: () => { throw new Error('EACCES: permission denied'); },
    }));
    expect(result.rowCounts).toEqual({ runway_entry: 4, dismissal: 1, runway_item: 0 });
    expect(result.pruneWarning).toMatch(/could not be cleaned up: EACCES/);
    expect(existsSync(result.backupPath)).toBe(true);
  });
});

describe('pruneRunwayBackups', () => {
  function touch(name: string): void {
    writeFileSync(join(backups, name), 'x');
  }

  beforeEach(() => mkdirSync(backups, { recursive: true }));

  it('keeps the newest 10 automatic backups and removes older ones', () => {
    const names = Array.from({ length: 13 }, (_, i) => backupFileName(new Date(2026, 0, 1 + i, 8, 0, 0)));
    names.forEach(touch);
    const removed = pruneRunwayBackups(backups, RUNWAY_BACKUP_KEEP, join(backups, names[12]));
    expect(removed.sort()).toEqual(names.slice(0, 3).sort());
    expect(readdirSync(backups).sort()).toEqual(names.slice(3).sort());
  });

  it('orders same-second backups by their sequence number', () => {
    const base = new Date(2026, 0, 1, 8, 0, 0);
    touch(backupFileName(base, 1));
    touch(backupFileName(base, 2));
    touch(backupFileName(base, 10));
    expect(pruneRunwayBackups(backups, 2)).toEqual([backupFileName(base, 1)]);
  });

  it('never touches manual exports, unrelated files, links or directories', () => {
    for (let i = 0; i < 12; i++) touch(backupFileName(new Date(2026, 0, 1 + i, 8, 0, 0)));
    const unrelated = [
      'vermilian-runway-20250101-080000.sqlite', // a manual export
      'notes.txt',
      'runway-before-import-20250101-080000.sqlite.bak',
      'runway-before-import-old.sqlite',
    ];
    unrelated.forEach(touch);
    const target = join(outDir, 'precious.sqlite');
    writeFileSync(target, 'precious');
    symlinkSync(target, join(backups, 'runway-before-import-20240101-000000.sqlite'));
    mkdirSync(join(backups, 'runway-before-import-20240101-000001.sqlite'));

    const removed = pruneRunwayBackups(backups, 10);
    expect(removed).toHaveLength(2);
    for (const name of unrelated) expect(existsSync(join(backups, name))).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('precious');
    expect(existsSync(join(backups, 'runway-before-import-20240101-000000.sqlite'))).toBe(true);
    expect(existsSync(join(backups, 'runway-before-import-20240101-000001.sqlite'))).toBe(true);
  });

  it('never removes the protected backup even when it would sort out', () => {
    for (let i = 0; i < 3; i++) touch(backupFileName(new Date(2026, 0, 10 + i, 8, 0, 0)));
    const old = backupFileName(new Date(2020, 0, 1, 8, 0, 0));
    touch(old);
    expect(pruneRunwayBackups(backups, 1, join(backups, old))).toHaveLength(2);
    expect(existsSync(join(backups, old))).toBe(true);
  });

  it('does not prune on a failed or cancelled import', async () => {
    for (let i = 0; i < 12; i++) touch(backupFileName(new Date(2025, 0, 1 + i, 8, 0, 0)));
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    // Cancelled: the staged copy is discarded and nothing else happens.
    discardStagedSnapshot(staged);
    expect(readdirSync(backups)).toHaveLength(12);
    // Failed: the import aborts before retention runs.
    const staged2 = stageRunwaySnapshot(await makeSnapshot('b.sqlite'), staging);
    await expectCode(
      importRunwaySnapshot(live, staged2, importOptions({ hooks: { afterDelete: () => { throw new Error('boom'); } } })),
      'import-failed',
    );
    expect(readdirSync(backups)).toHaveLength(13); // 12 + the failed import's backup
  });
});

describe('staging cleanup', () => {
  it('removes staged copies only', async () => {
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    writeFileSync(join(staging, 'keep-me.txt'), 'x');
    clearRunwayImportStaging(staging);
    expect(existsSync(staged.stagedPath)).toBe(false);
    expect(readdirSync(staging)).toEqual(['keep-me.txt']);
    clearRunwayImportStaging(join(dir, 'does-not-exist'));
  });
});

describe('RunwayWriteGate', () => {
  it('makes a write that arrives during an import wait until the import is finished', async () => {
    seedLive();
    const gate = new RunwayWriteGate();
    const staged = stageRunwaySnapshot(await makeSnapshot(), staging);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });

    const importing = gate.run(async () => {
      order.push('import:start');
      const result = await importRunwaySnapshot(live, staged, importOptions({ hooks: { afterBackup: () => held } }));
      order.push('import:end');
      return result;
    });
    // A Runway write queued while the import sits between backup and replace.
    const writing = gate.run(() => {
      order.push('write');
      insertEntries(live, [['ws-a', 'jira:AFTER-1', 1, null, 'after import', 0]]);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['import:start']);
    release();
    await importing;
    await writing;
    expect(order).toEqual(['import:start', 'import:end', 'write']);
    // The import replaced live with the snapshot; the queued write landed after it.
    expect(runwayRowCounts(live)).toEqual({ runway_entry: 5, dismissal: 1, runway_item: 0 });
  });

  it('keeps running later operations after one fails', async () => {
    const gate = new RunwayWriteGate();
    await expect(gate.run(() => { throw new Error('first'); })).rejects.toThrow('first');
    await expect(gate.run(() => 'second')).resolves.toBe('second');
  });
});

// ─── VERM-79: version 1 and version 2 snapshots ─────────────────────────────

const LATER = '2026-01-06T10:00:00.000Z';

type Item = [string, string, string, number, number, string | null];

function insertItems(db: DatabaseSync, items: Item[], at = NOW): void {
  const stmt = db.prepare(
    `INSERT INTO runway_item (workspace_id, item_id, kind, position, depth, text, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const i of items) stmt.run(...i, at, at);
}

function itemRows(db: DatabaseSync): unknown[] {
  return db.prepare('SELECT * FROM runway_item ORDER BY workspace_id, position').all();
}

// A version 1 snapshot exactly as Vermilian v1 exported it: a whole-file copy
// of a v1 database (schema v1, user_version 1, no origin table).
function v1Snapshot(name = 'v1-snapshot.sqlite'): string {
  return rawSnapshot(name, (db) => {
    db.exec(RUNWAY_SCHEMA_V1);
    db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
    db.exec('PRAGMA user_version = 1');
    insertEntries(db, [
      ['ws-a', 'jira:OLD-1', 1, 1, 'From the v1 machine', 0],
      ['ws-b', 'jira:OLD-2', 0, null, 'kept why now', 1],
    ]);
    insertDismissal(db, 'ws-a', 'jira:OLD-3', '2026-01-05');
  });
}

// A populated version 2 snapshot from "another computer", exported at `at`.
async function v2Snapshot(at: string, name = 'v2-snapshot.sqlite'): Promise<string> {
  const otherDir = mkdtempSync(join(tmpdir(), 'vermilian-import-v2-'));
  const other = openRunwayDb(join(otherDir, 'runway-metadata.sqlite'));
  try {
    insertEntries(other, [['ws-a', 'jira:DEMO-1', 1, 1, 'Due Friday', 0]]);
    insertDismissal(other, 'ws-a', 'jira:DEMO-5', '2026-01-05');
    insertItems(other, [
      ['ws-a', 'yt:DEMO-7', 'issue', 1, 0, null],
      ['ws-a', 'sec:00000000-0000-4000-8000-000000000001', 'section', 2, 0, 'Later'],
      ['ws-a', 'note:00000000-0000-4000-8000-000000000002', 'note', 3, 1, 'Ask about the release'],
      ['ws-a', 'jira:DEMO-1', 'issue', 4, 1, null],
      ['ws-b', 'jira:DEMO-1', 'issue', 1, 0, null],
    ]);
    const dest = join(outDir, name);
    await exportRunwaySnapshot(other, dest, { now: () => new Date(at), computerName: 'laptop-example' });
    return dest;
  } finally {
    other.close();
    rmSync(otherDir, { recursive: true, force: true });
  }
}

describe('version 1 snapshots (VERM-79)', () => {
  it('stages a v1 snapshot by upgrading the staged copy only', () => {
    const src = v1Snapshot();
    const original = readFileSync(src);
    const staged = stageRunwaySnapshot(src, staging);

    expect(staged.originalSchemaVersion).toBe(1);
    expect(staged.schemaVersion).toBe(2);
    expect(staged.exportedBy).toBeNull();
    expect(staged.exportedAt).toBeNull();
    expect(staged.rowCounts).toEqual({ runway_entry: 2, dismissal: 1, runway_item: 0 });
    // The chosen file is untouched and still v1.
    expect(readFileSync(src).equals(original)).toBe(true);
    // The staged copy is a v2 database that records no origin.
    const copy = new DatabaseSync(staged.stagedPath, { readOnly: true });
    try {
      expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
      expect(copy.prepare('SELECT count(*) AS n FROM runway_item').get()).toEqual({ n: 0 });
      expect(copy.prepare('SELECT count(*) AS n FROM runway_snapshot_info').get()).toEqual({ n: 0 });
    } finally {
      copy.close();
    }
    // Staging never touches the live database's version or content.
    expect(live.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
  });

  it('imports a v1 snapshot: Desk rows restored, Runway order emptied, backup first', async () => {
    seedLive();
    insertItems(live, [['ws-a', 'yt:LIVE-9', 'issue', 1, 0, null]]);
    const before = runwayFingerprint(live);
    const src = v1Snapshot();
    const result = await importRunwaySnapshot(live, stageRunwaySnapshot(src, staging), importOptions());

    const snap = new DatabaseSync(src, { readOnly: true });
    try {
      expect(rows(live, 'runway_entry')).toEqual(rows(snap, 'runway_entry'));
      expect(rows(live, 'dismissal')).toEqual(rows(snap, 'dismissal'));
    } finally {
      snap.close();
    }
    expect(itemRows(live)).toEqual([]);
    expect(result.previousRowCounts).toEqual({ runway_entry: 2, dismissal: 1, runway_item: 1 });
    // The pre-import backup holds the state that was replaced, Runway order included.
    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    try {
      expect(runwayFingerprint(backup)).toBe(before);
      expect(itemRows(backup)).toHaveLength(1);
    } finally {
      backup.close();
    }
  });

  it('still refuses a v1 snapshot whose schema differs from v1', () => {
    const src = rawSnapshot('v1-extra.sqlite', (db) => {
      db.exec(RUNWAY_SCHEMA_V1);
      db.exec('CREATE TABLE extra (x)');
      db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
      db.exec('PRAGMA user_version = 1');
    });
    expect(codeOf(() => stageRunwaySnapshot(src, staging))).toBe('schema-mismatch');
    expect(readdirSync(staging)).toEqual([]);
  });

  it('refuses schema version 0', () => {
    const src = rawSnapshot('v0.sqlite', (db) => {
      db.exec(RUNWAY_SCHEMA_V1);
      db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
    });
    expect(codeOf(() => stageRunwaySnapshot(src, staging))).toBe('unsupported-schema');
  });
});

describe('version 2 snapshots (VERM-79)', () => {
  it('records the exporting computer and export time, and restores the Runway order exactly', async () => {
    seedLive();
    insertItems(live, [['ws-a', 'yt:LIVE-9', 'issue', 1, 0, null]]);
    const src = await v2Snapshot(NOW);
    const staged = stageRunwaySnapshot(src, staging);
    expect(staged.originalSchemaVersion).toBe(2);
    expect(staged.exportedBy).toBe('laptop-example');
    expect(staged.exportedAt).toBe(NOW);
    expect(staged.rowCounts).toEqual({ runway_entry: 1, dismissal: 1, runway_item: 5 });

    const result = await importRunwaySnapshot(live, staged, importOptions());
    const snap = new DatabaseSync(src, { readOnly: true });
    try {
      expect(itemRows(live)).toEqual(itemRows(snap));
      expect(rows(live, 'runway_entry')).toEqual(rows(snap, 'runway_entry'));
      expect(rows(live, 'dismissal')).toEqual(rows(snap, 'dismissal'));
    } finally {
      snap.close();
    }
    expect(result.rowCounts).toEqual({ runway_entry: 1, dismissal: 1, runway_item: 5 });
    // The live database never takes the snapshot-only origin table.
    const liveTables = live
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(liveTables).toEqual(['dismissal', 'runway_entry', 'runway_item']);
  });

  it('a pre-import backup is itself a v2 snapshot that restores the replaced order', async () => {
    insertItems(live, [
      ['ws-a', 'yt:LIVE-1', 'issue', 1, 0, null],
      ['ws-a', 'yt:LIVE-2', 'issue', 2, 0, null],
    ]);
    const original = itemRows(live);
    const first = await importRunwaySnapshot(live, stageRunwaySnapshot(await v2Snapshot(NOW), staging), importOptions());
    expect(itemRows(live)).not.toEqual(original);

    const restore = stageRunwaySnapshot(first.backupPath, staging);
    expect(restore.originalSchemaVersion).toBe(2);
    await importRunwaySnapshot(live, restore, importOptions({ now: () => new Date(2026, 0, 5, 9, 31, 0) }));
    expect(itemRows(live)).toEqual(original);
  });

  it('refuses a v2 snapshot without the origin table', () => {
    const src = rawSnapshot('v2-no-origin.sqlite', (db) => {
      db.exec(RUNWAY_SCHEMA_V1);
      db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
      db.exec('PRAGMA user_version = 1');
    });
    // Built at v1, then upgraded like a live file: v2 tables, no origin table.
    const upgraded = openRunwayDb(src, { backupDir: join(outDir, 'pre-migration') });
    upgraded.close();
    expect(codeOf(() => stageRunwaySnapshot(src, staging))).toBe('schema-mismatch');
  });

  async function forged(mutate: (db: DatabaseSync) => void): Promise<string> {
    const src = await v2Snapshot(NOW, `forged-${Math.random().toString(16).slice(2)}.sqlite`);
    const db = new DatabaseSync(src);
    try {
      mutate(db);
    } finally {
      db.close();
    }
    return src;
  }

  it('refuses Runway order rows that break the rules', async () => {
    const gap = await forged((db) => db.exec(`UPDATE runway_item SET position = 9 WHERE item_id = 'jira:DEMO-1' AND workspace_id = 'ws-a'`));
    expect(codeOf(() => stageRunwaySnapshot(gap, staging))).toBe('invalid-data');
    const badId = await forged((db) => db.exec(`UPDATE runway_item SET item_id = 'DEMO-7' WHERE item_id = 'yt:DEMO-7'`));
    expect(codeOf(() => stageRunwaySnapshot(badId, staging))).toBe('invalid-data');
    const textOnTicket = await forged((db) => db.exec(`UPDATE runway_item SET text = 'x' WHERE item_id = 'yt:DEMO-7'`));
    expect(codeOf(() => stageRunwaySnapshot(textOnTicket, staging))).toBe('invalid-data');
    const wrongPrefix = await forged((db) =>
      db.exec(`UPDATE runway_item SET kind = 'note' WHERE item_id LIKE 'sec:%'`),
    );
    expect(codeOf(() => stageRunwaySnapshot(wrongPrefix, staging))).toBe('invalid-data');
    expect(readdirSync(staging)).toEqual([]);
  });
});

describe('runwayImportWarning (VERM-79)', () => {
  it('v1 snapshot: cannot tell when this computer has Runway data, nothing when it has none', () => {
    expect(runwayImportWarning(live, { exportedAt: null })).toBeNull();
    insertDismissal(live, 'ws-a', 'jira:LIVE-3', '2026-01-05');
    expect(runwayImportWarning(live, { exportedAt: null })).toEqual({ kind: 'cannot-tell' });
  });

  it('v2 snapshot: warns, naming the latest change, only when local data is newer than the export', () => {
    insertEntries(live, [['ws-a', 'jira:LIVE-1', 1, 1, null, 0]]); // at NOW
    expect(runwayImportWarning(live, { exportedAt: NOW })).toBeNull();
    expect(runwayImportWarning(live, { exportedAt: LATER })).toBeNull();

    insertItems(live, [['ws-b', 'yt:LIVE-9', 'issue', 1, 0, null]], LATER);
    expect(runwayImportWarning(live, { exportedAt: NOW })).toEqual({
      kind: 'newer-local-changes',
      latestLocalChange: {
        table: 'runway_item',
        workspaceId: 'ws-b',
        itemId: 'yt:LIVE-9',
        kind: 'issue',
        updatedAt: LATER,
      },
    });
  });

  it('names a Desk entry when it is the latest change', () => {
    insertItems(live, [['ws-b', 'yt:LIVE-9', 'issue', 1, 0, null]], NOW);
    live
      .prepare(
        `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
         VALUES ('ws-a', 'jira:LIVE-1', 1, NULL, NULL, 0, ?)`,
      )
      .run(LATER);
    expect(latestLocalRunwayChange(live)).toMatchObject({ table: 'runway_entry', itemId: 'jira:LIVE-1' });
  });

  it('warns rather than guess when a time cannot be read', () => {
    insertEntries(live, [['ws-a', 'jira:LIVE-1', 1, 1, null, 0]]);
    expect(runwayImportWarning(live, { exportedAt: 'not a time' })?.kind).toBe('newer-local-changes');
  });
});

// ─── Undatable differences (VERM-79, Kevin 2026-11-21) ──────────────────────
//
// Dismissals carry no timestamp and a removal leaves none, so for these the
// export time cannot say which copy is newer. The preview compares the
// affected records instead and warns when the import would change them.

describe('runwayImportWarnings: undatable differences', () => {
  // Exports `live` as it stands, at `at`, and stages that snapshot.
  async function exportLive(at: string, name: string) {
    const dest = join(outDir, name);
    await exportRunwaySnapshot(live, dest, { now: () => new Date(at), computerName: 'laptop-example' });
    return stageRunwaySnapshot(dest, staging);
  }

  function seedRunway(): void {
    insertEntries(live, [['ws-a', 'jira:DEMO-1', 1, 1, 'Due Friday', 0]]);
    insertDismissal(live, 'ws-a', 'jira:DEMO-5', '2026-01-05');
    insertItems(live, [
      ['ws-a', 'yt:DEMO-7', 'issue', 1, 0, null],
      ['ws-a', 'jira:DEMO-1', 'issue', 2, 0, null],
    ]);
  }

  it('stays quiet when the snapshot holds exactly this computer\'s data', async () => {
    seedRunway();
    const staged = await exportLive(LATER, 'same.sqlite');
    expect(runwayImportWarnings(live, staged)).toEqual([]);
  });

  it('warns on a dismissal-only difference, naming it', async () => {
    seedRunway();
    const staged = await exportLive(LATER, 'dismissal.sqlite');
    // After the export, only a dismissal changes here: one added, one moved week.
    insertDismissal(live, 'ws-a', 'jira:DEMO-6', '2026-01-12');
    live.prepare(`UPDATE dismissal SET dismissed_week_of = '2026-01-12' WHERE issue_id = 'jira:DEMO-5'`).run();
    // No timestamped record changed, so the export time alone sees nothing.
    expect(runwayImportWarning(live, staged)).toBeNull();

    const warnings = runwayImportWarnings(live, staged);
    expect(warnings).toEqual([
      {
        kind: 'undatable-differences',
        dismissals: [
          { workspaceId: 'ws-a', issueId: 'jira:DEMO-5', local: '2026-01-12', snapshot: '2026-01-05' },
          { workspaceId: 'ws-a', issueId: 'jira:DEMO-6', local: '2026-01-12', snapshot: null },
        ],
        restored: [],
      },
    ]);
  });

  it('warns when the snapshot would restore a Runway ticket removed here', async () => {
    seedRunway();
    const staged = await exportLive(LATER, 'removed.sqlite');
    // Remove the Runway's last ticket after the export. A removal leaves no
    // timestamp, so only comparing records can see it.
    live.prepare(`DELETE FROM runway_item WHERE workspace_id = 'ws-a' AND position = 2`).run();
    expect(runwayImportWarning(live, staged)).toBeNull();

    expect(runwayImportWarnings(live, staged)).toEqual([
      {
        kind: 'undatable-differences',
        dismissals: [],
        restored: [{ table: 'runway_item', workspaceId: 'ws-a', itemId: 'jira:DEMO-1', kind: 'issue' }],
      },
    ]);
  });

  it('warns when the snapshot would restore a Desk entry removed here', async () => {
    seedRunway();
    const staged = await exportLive(LATER, 'desk-removed.sqlite');
    live.prepare(`DELETE FROM runway_entry WHERE issue_id = 'jira:DEMO-1'`).run();
    expect(runwayImportWarnings(live, staged)).toEqual([
      {
        kind: 'undatable-differences',
        dismissals: [],
        restored: [{ table: 'runway_entry', workspaceId: 'ws-a', itemId: 'jira:DEMO-1', kind: 'issue' }],
      },
    ]);
  });

  it('reports a newer local change and undatable differences together', async () => {
    seedRunway();
    const staged = await exportLive(NOW, 'both.sqlite');
    live.prepare(`DELETE FROM runway_item WHERE position = 2`).run();
    insertItems(live, [['ws-b', 'yt:LIVE-9', 'issue', 1, 0, null]], LATER);
    expect(runwayImportWarnings(live, staged).map((w) => w.kind)).toEqual([
      'newer-local-changes',
      'undatable-differences',
    ]);
  });

  it('a version 1 snapshot keeps the single cannot-tell warning', () => {
    insertDismissal(live, 'ws-a', 'jira:LIVE-3', '2026-01-05');
    const staged = stageRunwaySnapshot(v1Snapshot(), staging);
    expect(runwayImportWarnings(live, staged)).toEqual([{ kind: 'cannot-tell' }]);
  });
});

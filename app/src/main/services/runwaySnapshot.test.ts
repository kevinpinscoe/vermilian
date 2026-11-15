import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_VERSION, openRunwayDb } from './runwayDb';
import {
  RunwaySnapshotError,
  defaultSnapshotFileName,
  exportRunwaySnapshot,
  runwayRowCounts,
} from './runwaySnapshot';

let dir: string;
let outDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vermilian-snapshot-test-'));
  outDir = mkdtempSync(join(tmpdir(), 'vermilian-snapshot-out-'));
  db = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

const NOW = '2026-01-05T09:00:00.000Z';

// Two workspaces, so the test proves the export is the whole database and
// not just the active workspace or the entries currently on screen.
function seed(target: DatabaseSync): void {
  const entry = target.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  entry.run('ws-a', 'jira:DEMO-1', 1, 1, 'Due Friday', 0, NOW);
  entry.run('ws-a', 'jira:DEMO-2', 1, null, null, 0, NOW);
  entry.run('ws-a', 'jira:DEMO-3', 0, null, 'Kept after unfocus', 1, NOW);
  entry.run('ws-b', 'jira:DEMO-1', 1, 1, 'Other workspace', 0, NOW);
  const dismissal = target.prepare(
    'INSERT INTO dismissal (workspace_id, issue_id, dismissed_week_of) VALUES (?, ?, ?)',
  );
  dismissal.run('ws-a', 'jira:DEMO-4', '2026-01-05');
  dismissal.run('ws-b', 'jira:DEMO-5', '2026-01-05');
}

function pragma(target: DatabaseSync, name: string): unknown {
  const row = target.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

function rows(target: DatabaseSync, table: string): unknown[] {
  return target.prepare(`SELECT * FROM ${table} ORDER BY workspace_id, issue_id`).all();
}

describe('exportRunwaySnapshot', () => {
  it('writes the whole database as a verified snapshot', async () => {
    seed(db);
    const dest = join(outDir, 'snapshot.sqlite');
    const summary = await exportRunwaySnapshot(db, dest, () => new Date(NOW));

    expect(summary).toMatchObject({
      path: dest,
      exportedAt: NOW,
      schemaVersion: RUNWAY_SCHEMA_VERSION,
      rowCounts: { runway_entry: 4, dismissal: 2 },
    });
    expect(summary.pages).toBeGreaterThan(0);

    const copy = new DatabaseSync(dest, { readOnly: true });
    try {
      expect(pragma(copy, 'integrity_check')).toBe('ok');
      expect(pragma(copy, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
      expect(pragma(copy, 'user_version')).toBe(RUNWAY_SCHEMA_VERSION);
      expect(runwayRowCounts(copy)).toEqual(runwayRowCounts(db));
      expect(rows(copy, 'runway_entry')).toEqual(rows(db, 'runway_entry'));
      expect(rows(copy, 'dismissal')).toEqual(rows(db, 'dismissal'));
      // The schema itself travels too (constraints, the rank index), so the
      // snapshot is a database VERM-51 can restore as-is.
      const schema = (t: DatabaseSync) =>
        t.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all();
      expect(schema(copy)).toEqual(schema(db));
    } finally {
      copy.close();
    }
    // Only the snapshot is left — no temporary or journal files.
    expect(readdirSync(outDir)).toEqual(['snapshot.sqlite']);
  });

  it('exports an empty database as a valid snapshot', async () => {
    const dest = join(outDir, 'empty.sqlite');
    const summary = await exportRunwaySnapshot(db, dest);
    expect(summary.rowCounts).toEqual({ runway_entry: 0, dismissal: 0 });
    const copy = new DatabaseSync(dest, { readOnly: true });
    expect(pragma(copy, 'integrity_check')).toBe('ok');
    copy.close();
  });

  it('leaves the source database usable and unchanged', async () => {
    seed(db);
    const before = rows(db, 'runway_entry');
    await exportRunwaySnapshot(db, join(outDir, 'a.sqlite'));
    expect(rows(db, 'runway_entry')).toEqual(before);
    db.prepare(
      `INSERT INTO runway_entry (workspace_id, issue_id, focus, updated_at) VALUES ('ws-a', 'jira:DEMO-9', 1, ?)`,
    ).run(NOW);
    expect(runwayRowCounts(db).runway_entry).toBe(5);
  });

  it('captures a consistent point in time while writes continue', async () => {
    seed(db);
    // Enough rows for the copy to take several backup steps.
    const insert = db.prepare(
      `INSERT INTO runway_entry (workspace_id, issue_id, focus, why_now, updated_at) VALUES (?, ?, 0, ?, ?)`,
    );
    db.exec('BEGIN');
    for (let i = 0; i < 3000; i++) insert.run('ws-bulk', `jira:BULK-${i}`, 'x'.repeat(200), NOW);
    db.exec('COMMIT');

    const dest = join(outDir, 'busy.sqlite');
    const exporting = exportRunwaySnapshot(db, dest);
    // A write made while the export is in flight must not fail.
    insert.run('ws-bulk', 'jira:BULK-late', 'late', NOW);
    const summary = await exporting;

    const copy = new DatabaseSync(dest, { readOnly: true });
    try {
      expect(pragma(copy, 'integrity_check')).toBe('ok');
      // Whatever point in time was captured, the counts reported are the
      // copy's own and the copy is internally consistent.
      expect(runwayRowCounts(copy)).toEqual(summary.rowCounts);
      expect(summary.rowCounts.runway_entry === 3004 || summary.rowCounts.runway_entry === 3005).toBe(true);
    } finally {
      copy.close();
    }
  });

  it('never overwrites an existing file', async () => {
    seed(db);
    const dest = join(outDir, 'existing.sqlite');
    writeFileSync(dest, 'keep me');
    await expect(exportRunwaySnapshot(db, dest)).rejects.toMatchObject({
      name: 'RunwaySnapshotError',
      code: 'destination-exists',
    });
    expect(readFileSync(dest, 'utf8')).toBe('keep me');
    expect(readdirSync(outDir)).toEqual(['existing.sqlite']);
  });

  it('refuses a destination that is a symbolic link, even a dangling one', async () => {
    const dest = join(outDir, 'link.sqlite');
    symlinkSync(join(outDir, 'nowhere.sqlite'), dest);
    await expect(exportRunwaySnapshot(db, dest)).rejects.toMatchObject({ code: 'destination-exists' });
    expect(readdirSync(outDir)).toEqual(['link.sqlite']);
  });

  it('refuses to export over the live database itself', async () => {
    await expect(exportRunwaySnapshot(db, join(dir, 'runway-metadata.sqlite'))).rejects.toMatchObject({
      code: 'destination-exists',
    });
  });

  it('refuses a relative or empty destination', async () => {
    await expect(exportRunwaySnapshot(db, 'snapshot.sqlite')).rejects.toMatchObject({ code: 'invalid-destination' });
    await expect(exportRunwaySnapshot(db, '')).rejects.toMatchObject({ code: 'invalid-destination' });
  });

  it('leaves nothing behind when the destination directory is missing', async () => {
    const dest = join(outDir, 'missing', 'snapshot.sqlite');
    const err = await exportRunwaySnapshot(db, dest).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunwaySnapshotError);
    expect((err as RunwaySnapshotError).code).toBe('export-failed');
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('publishes nothing when the copy fails verification', async () => {
    // A database that is SQLite but not a Runway database: the backup works,
    // verification must refuse it and remove the temporary copy.
    const foreign = new DatabaseSync(join(dir, 'foreign.sqlite'));
    foreign.exec('CREATE TABLE other (x INTEGER)');
    try {
      const dest = join(outDir, 'foreign-copy.sqlite');
      await expect(exportRunwaySnapshot(foreign, dest)).rejects.toMatchObject({ code: 'verification-failed' });
      expect(readdirSync(outDir)).toEqual([]);
    } finally {
      foreign.close();
    }
  });
});

describe('defaultSnapshotFileName', () => {
  it('stamps the local date and time', () => {
    expect(defaultSnapshotFileName(new Date(2026, 10, 15, 9, 5, 7))).toBe('vermilian-runway-20261115-090507.sqlite');
  });
});

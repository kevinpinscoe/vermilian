import { linkSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_VERSION, openRunwayDb } from './runwayDb';
import {
  RunwaySnapshotError,
  type SnapshotFs,
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
    const summary = await exportRunwaySnapshot(db, dest, { now: () => new Date(NOW) });

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

// Publication (the last step) through an injected filesystem, so the cases a
// real disk cannot produce on demand — no hard links, a file that appears
// between the existence check and the link — are exercised exactly.
describe('exportRunwaySnapshot publication', () => {
  function errno(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: simulated`), { code });
  }

  it('publishes the verified copy with one hard link', async () => {
    seed(db);
    const dest = join(outDir, 'linked.sqlite');
    const calls: Array<[string, string]> = [];
    const fs: SnapshotFs = {
      link(tmp, target) {
        calls.push([tmp, target]);
        // What is about to be published is already a complete, valid database.
        const check = new DatabaseSync(tmp, { readOnly: true });
        try {
          expect(pragma(check, 'integrity_check')).toBe('ok');
          expect(runwayRowCounts(check)).toEqual(runwayRowCounts(db));
        } finally {
          check.close();
        }
        linkSync(tmp, target);
      },
    };
    await exportRunwaySnapshot(db, dest, { fs });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(dest);
    expect(calls[0][0]).toMatch(/[/\\]\.linked\.sqlite\.partial-[0-9a-f]{16}$/);
    expect(readdirSync(outDir)).toEqual(['linked.sqlite']);
  });

  for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']) {
    it(`fails safely without creating the destination when hard links are unsupported (${code})`, async () => {
      seed(db);
      const dest = join(outDir, 'nolinks.sqlite');
      const err = await exportRunwaySnapshot(db, dest, {
        fs: { link: () => { throw errno(code); } },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RunwaySnapshotError);
      expect((err as RunwaySnapshotError).code).toBe('publication-unsupported');
      expect((err as Error).message).toMatch(/No snapshot was created/);
      expect((err as Error).message).toMatch(/Choose a folder on a local disk/);
      expect(readdirSync(outDir)).toEqual([]);
    });
  }

  it('refuses, and leaves untouched, a file created between the check and publication', async () => {
    seed(db);
    const dest = join(outDir, 'race.sqlite');
    const fs: SnapshotFs = {
      link(tmp, target) {
        writeFileSync(target, 'created by someone else'); // appears after the up-front check
        linkSync(tmp, target); // the real link then fails with EEXIST
      },
    };
    await expect(exportRunwaySnapshot(db, dest, { fs })).rejects.toMatchObject({ code: 'destination-exists' });
    expect(readFileSync(dest, 'utf8')).toBe('created by someone else');
    expect(readdirSync(outDir)).toEqual(['race.sqlite']);
  });

  it('refuses, and leaves untouched, a symbolic link created between the check and publication', async () => {
    const dest = join(outDir, 'race-link.sqlite');
    const fs: SnapshotFs = {
      link(tmp, target) {
        symlinkSync(join(outDir, 'elsewhere.sqlite'), target);
        linkSync(tmp, target);
      },
    };
    await expect(exportRunwaySnapshot(db, dest, { fs })).rejects.toMatchObject({ code: 'destination-exists' });
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(readlinkSync(dest)).toBe(join(outDir, 'elsewhere.sqlite'));
    expect(readdirSync(outDir)).toEqual(['race-link.sqlite']);
  });

  it('never deletes a destination it did not create when publication fails', async () => {
    const dest = join(outDir, 'theirs.sqlite');
    // The link "fails" after another process put a file there.
    const fs: SnapshotFs = {
      link(_tmp, target) {
        writeFileSync(target, 'theirs');
        throw errno('EIO');
      },
    };
    await expect(exportRunwaySnapshot(db, dest, { fs })).rejects.toMatchObject({ code: 'export-failed' });
    expect(readFileSync(dest, 'utf8')).toBe('theirs');
    expect(readdirSync(outDir)).toEqual(['theirs.sqlite']);
  });

  it('leaves no snapshot or temporary file when publication fails', async () => {
    seed(db);
    const dest = join(outDir, 'failed.sqlite');
    await expect(
      exportRunwaySnapshot(db, dest, { fs: { link: () => { throw errno('EIO'); } } }),
    ).rejects.toMatchObject({ code: 'export-failed' });
    expect(readdirSync(outDir)).toEqual([]);
    // The source is unaffected and still usable.
    expect(runwayRowCounts(db)).toEqual({ runway_entry: 4, dismissal: 2 });
  });

  it('does not call link at all when the destination already exists', async () => {
    const dest = join(outDir, 'existing.sqlite');
    writeFileSync(dest, 'keep me');
    let linked = false;
    await expect(
      exportRunwaySnapshot(db, dest, { fs: { link: () => { linked = true; } } }),
    ).rejects.toMatchObject({ code: 'destination-exists' });
    expect(linked).toBe(false);
    expect(readFileSync(dest, 'utf8')).toBe('keep me');
  });
});

describe('defaultSnapshotFileName', () => {
  it('stamps the local date and time', () => {
    expect(defaultSnapshotFileName(new Date(2026, 10, 15, 9, 5, 7))).toBe('vermilian-runway-20261115-090507.sqlite');
  });
});

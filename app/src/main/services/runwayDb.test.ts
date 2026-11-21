import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RUNWAY_APPLICATION_ID,
  RUNWAY_BACKUP_DIRNAME,
  RUNWAY_SCHEMA_V1,
  RUNWAY_SCHEMA_VERSION,
  RunwayDbError,
  openRunwayDb,
  requireJiraIssueId,
} from './runwayDb';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vermilian-runway-test-'));
  dbPath = join(dir, 'runway-metadata.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pragma(db: DatabaseSync, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

const NOW = '2026-01-05T09:00:00.000Z';

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name);
}

function indexNames(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name);
}

/** Writes a schema v1 file exactly as Vermilian v1 created it. */
function writeV1File(path: string, fill: (db: DatabaseSync) => void = () => undefined): void {
  const raw = new DatabaseSync(path);
  raw.exec(RUNWAY_SCHEMA_V1);
  raw.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
  raw.exec('PRAGMA user_version = 1');
  fill(raw);
  raw.close();
}

function allRows(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY workspace_id, issue_id`).all();
}

function insertItem(
  db: DatabaseSync,
  workspace: string,
  item: string,
  position: number,
  kind = 'issue',
): void {
  db.prepare(
    `INSERT INTO runway_item (workspace_id, item_id, kind, position, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(workspace, item, kind, position, NOW, NOW);
}

function insertEntry(
  db: DatabaseSync,
  workspace: string,
  issue: string,
  opts: { focus?: number; rank?: number | null; whyNow?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(workspace, issue, opts.focus ?? 1, opts.rank ?? null, opts.whyNow ?? null, NOW);
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RunwayDbError);
    expect((err as RunwayDbError).code).toBe(code);
    return;
  }
  throw new Error(`expected RunwayDbError ${code}`);
}

describe('openRunwayDb: create and open', () => {
  it('creates a new database with schema v2 and identifying pragmas', () => {
    const db = openRunwayDb(dbPath);
    expect(RUNWAY_SCHEMA_VERSION).toBe(2);
    expect(pragma(db, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
    expect(pragma(db, 'user_version')).toBe(2);
    expect(pragma(db, 'integrity_check')).toBe('ok');
    expect(tableNames(db)).toEqual(['dismissal', 'runway_entry', 'runway_item']);
    expect(indexNames(db)).toEqual(['runway_entry_rank_unique', 'runway_item_position']);
    db.close();
    // A fresh file has nothing to migrate, so no pre-migration copy is written.
    expect(existsSync(join(dir, RUNWAY_BACKUP_DIRNAME))).toBe(false);
  });

  it('reopens an existing database and keeps its data', () => {
    const first = openRunwayDb(dbPath);
    insertEntry(first, 'ws-a', 'jira:DEMO-1', { rank: 1, whyNow: 'Due Friday' });
    first.close();

    const second = openRunwayDb(dbPath);
    const row = second.prepare('SELECT * FROM runway_entry').get() as Record<string, unknown>;
    expect(row).toMatchObject({ workspace_id: 'ws-a', issue_id: 'jira:DEMO-1', focus_rank: 1, why_now: 'Due Friday' });
    expect(pragma(second, 'user_version')).toBe(RUNWAY_SCHEMA_VERSION);
    second.close();
  });

  it('initialises an existing empty file', () => {
    writeFileSync(dbPath, '');
    const db = openRunwayDb(dbPath);
    expect(pragma(db, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
    db.close();
  });
});

describe('openRunwayDb: version and identity guard', () => {
  it('refuses a newer schema version and leaves the file unchanged', () => {
    openRunwayDb(dbPath).close();
    const raw = new DatabaseSync(dbPath);
    raw.exec(`PRAGMA user_version = ${RUNWAY_SCHEMA_VERSION + 1}`);
    raw.close();
    const before = readFileSync(dbPath);

    expectCode(() => openRunwayDb(dbPath), 'newer-schema');
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('refuses a database with another application_id', () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA application_id = 1234; PRAGMA user_version = 1; CREATE TABLE t (x)');
    raw.close();
    expectCode(() => openRunwayDb(dbPath), 'foreign-database');
  });

  it('refuses an unrelated SQLite database without adding the schema to it', () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE TABLE other (x)');
    raw.close();
    const before = readFileSync(dbPath);

    expectCode(() => openRunwayDb(dbPath), 'foreign-database');
    expect(readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('refuses a Vermilian application_id with no schema version', () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
    raw.close();
    expectCode(() => openRunwayDb(dbPath), 'incomplete-schema');
  });

  it('refuses a file that is not SQLite and leaves it unchanged', () => {
    const junk = Buffer.from('this is not an SQLite database, just text padding it out '.repeat(20));
    writeFileSync(dbPath, junk);
    expectCode(() => openRunwayDb(dbPath), 'not-a-database');
    expect(readFileSync(dbPath).equals(junk)).toBe(true);
  });
});

describe('openRunwayDb: v1 to v2 migration', () => {
  function fillDesk(db: DatabaseSync): void {
    insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 1, whyNow: 'Due Friday' });
    insertEntry(db, 'ws-a', 'jira:DEMO-2', { rank: null, focus: 0, whyNow: 'Kept after unfocus' });
    insertEntry(db, 'ws-b', 'jira:DEMO-1', { rank: 2 });
    db.prepare('INSERT INTO dismissal (workspace_id, issue_id, dismissed_week_of) VALUES (?, ?, ?)').run(
      'ws-a',
      'jira:DEMO-9',
      '2026-01-05',
    );
  }

  function v1Rows(path: string): { entries: unknown[]; dismissals: unknown[] } {
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      return { entries: allRows(raw, 'runway_entry'), dismissals: allRows(raw, 'dismissal') };
    } finally {
      raw.close();
    }
  }

  it('migrates a v1 file additively, keeping every Desk and dismissal row', () => {
    writeV1File(dbPath, fillDesk);
    const before = v1Rows(dbPath);
    expect(before.entries).toHaveLength(3);
    expect(before.dismissals).toHaveLength(1);

    const db = openRunwayDb(dbPath);
    expect(pragma(db, 'user_version')).toBe(2);
    expect(pragma(db, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
    expect(pragma(db, 'integrity_check')).toBe('ok');
    expect(tableNames(db)).toEqual(['dismissal', 'runway_entry', 'runway_item']);
    expect(allRows(db, 'runway_entry')).toEqual(before.entries);
    expect(allRows(db, 'dismissal')).toEqual(before.dismissals);
    expect(db.prepare('SELECT count(*) AS n FROM runway_item').get()).toEqual({ n: 0 });
    db.close();
  });

  it('writes a verified pre-migration copy holding the original v1 rows', () => {
    writeV1File(dbPath, fillDesk);
    const before = v1Rows(dbPath);

    openRunwayDb(dbPath).close();

    const backupDir = join(dir, RUNWAY_BACKUP_DIRNAME);
    const names = readdirSync(backupDir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^runway-pre-v2-migration-\d{8}-\d{6}\.sqlite$/);
    const copy = new DatabaseSync(join(backupDir, names[0]), { readOnly: true });
    try {
      expect(pragma(copy, 'user_version')).toBe(1);
      expect(pragma(copy, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
      expect(pragma(copy, 'integrity_check')).toBe('ok');
      expect(tableNames(copy)).toEqual(['dismissal', 'runway_entry']);
      expect(allRows(copy, 'runway_entry')).toEqual(before.entries);
      expect(allRows(copy, 'dismissal')).toEqual(before.dismissals);
    } finally {
      copy.close();
    }
  });

  it('writes the copy to the backup directory it is given', () => {
    writeV1File(dbPath, fillDesk);
    const elsewhere = join(dir, 'custom-backups');
    openRunwayDb(dbPath, { backupDir: elsewhere }).close();
    expect(readdirSync(elsewhere)).toHaveLength(1);
    expect(existsSync(join(dir, RUNWAY_BACKUP_DIRNAME))).toBe(false);
  });

  it('never overwrites an earlier pre-migration copy with the same timestamp', () => {
    const now = () => new Date(2026, 0, 5, 9, 0, 0);
    writeV1File(dbPath, fillDesk);
    openRunwayDb(dbPath, { now }).close();
    rmSync(dbPath);
    writeV1File(dbPath);
    openRunwayDb(dbPath, { now }).close();
    expect(readdirSync(join(dir, RUNWAY_BACKUP_DIRNAME)).sort()).toEqual([
      'runway-pre-v2-migration-20260105-090000-2.sqlite',
      'runway-pre-v2-migration-20260105-090000.sqlite',
    ]);
  });

  it('leaves the file at v1, byte for byte, when the copy cannot be written', () => {
    writeV1File(dbPath, fillDesk);
    const bytes = readFileSync(dbPath);
    // A regular file where the backup directory should be: mkdir fails.
    const blocked = join(dir, 'not-a-directory');
    writeFileSync(blocked, 'x');

    expectCode(() => openRunwayDb(dbPath, { backupDir: blocked }), 'migration-backup-failed');
    expect(readFileSync(dbPath).equals(bytes)).toBe(true);
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    expect(pragma(raw, 'user_version')).toBe(1);
    expect(tableNames(raw)).toEqual(['dismissal', 'runway_entry']);
    raw.close();

    // Once the cause is cleared the next open migrates normally.
    rmSync(blocked);
    const db = openRunwayDb(dbPath, { backupDir: blocked });
    expect(pragma(db, 'user_version')).toBe(2);
    db.close();
  });

  it('leaves the file at v1 and removes the copy when the copy fails verification', () => {
    writeV1File(dbPath, fillDesk);
    const bytes = readFileSync(dbPath);
    const backupDir = join(dir, RUNWAY_BACKUP_DIRNAME);

    expectCode(
      () =>
        openRunwayDb(dbPath, {
          verifyBackup: () => {
            throw new Error('simulated verification failure');
          },
        }),
      'migration-backup-failed',
    );
    expect(readFileSync(dbPath).equals(bytes)).toBe(true);
    expect(readdirSync(backupDir)).toEqual([]);
  });

  it('opens a v2 file without migrating or copying it again', () => {
    writeV1File(dbPath, fillDesk);
    openRunwayDb(dbPath).close();
    const db = openRunwayDb(dbPath);
    expect(pragma(db, 'user_version')).toBe(2);
    db.close();
    expect(readdirSync(join(dir, RUNWAY_BACKUP_DIRNAME))).toHaveLength(1);
  });

  it('refuses a v1-numbered file whose tables are missing, without copying it', () => {
    const raw = new DatabaseSync(dbPath);
    raw.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}; PRAGMA user_version = 1; CREATE TABLE other (x)`);
    raw.close();
    const bytes = readFileSync(dbPath);
    expectCode(() => openRunwayDb(dbPath), 'incomplete-schema');
    expect(readFileSync(dbPath).equals(bytes)).toBe(true);
    expect(existsSync(join(dir, RUNWAY_BACKUP_DIRNAME))).toBe(false);
  });
});

describe('runway_item rules', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openRunwayDb(dbPath);
  });
  afterEach(() => db.close());

  it('accepts YouTrack and Jira tickets, sections and notes', () => {
    insertItem(db, 'ws-a', 'yt:DEMO-1', 1);
    insertItem(db, 'ws-a', 'jira:DEMO-2', 2);
    insertItem(db, 'ws-a', 'sec:0b6f8f0e-0000-4000-8000-000000000001', 3, 'section');
    insertItem(db, 'ws-a', 'note:0b6f8f0e-0000-4000-8000-000000000002', 4, 'note');
    const n = db.prepare('SELECT count(*) AS n FROM runway_item').get() as { n: number };
    expect(n.n).toBe(4);
  });

  it('gives one ticket its own position in each workspace', () => {
    insertItem(db, 'ws-a', 'yt:DEMO-1', 3);
    insertItem(db, 'ws-b', 'yt:DEMO-1', 1);
    expect(() => insertItem(db, 'ws-a', 'yt:DEMO-1', 4)).toThrow(/UNIQUE constraint failed/);
  });

  it('refuses two rows at one position in the same workspace', () => {
    insertItem(db, 'ws-a', 'yt:DEMO-1', 1);
    expect(() => insertItem(db, 'ws-a', 'yt:DEMO-2', 1)).toThrow(/UNIQUE constraint failed/);
    insertItem(db, 'ws-b', 'yt:DEMO-2', 1);
  });

  it('refuses an unknown kind, a position below 1, a bad depth and empty keys', () => {
    expect(() => insertItem(db, 'ws-a', 'yt:DEMO-1', 1, 'epic')).toThrow(/CHECK constraint failed/);
    expect(() => insertItem(db, 'ws-a', 'yt:DEMO-1', 0)).toThrow(/CHECK constraint failed/);
    expect(() => insertItem(db, '', 'yt:DEMO-1', 1)).toThrow(/CHECK constraint failed/);
    expect(() => insertItem(db, 'ws-a', '', 1)).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO runway_item (workspace_id, item_id, kind, position, depth, added_at, updated_at)
           VALUES ('ws-a', 'yt:DEMO-1', 'issue', 1, 5, ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('runway_entry keys and rank rules', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openRunwayDb(dbPath);
  });
  afterEach(() => db.close());

  it('keys entries by workspace and provider-qualified issue ID', () => {
    insertEntry(db, 'ws-a', 'jira:DEMO-1', { whyNow: 'A' });
    insertEntry(db, 'ws-b', 'jira:DEMO-1', { whyNow: 'B' });
    const rows = db.prepare('SELECT workspace_id, why_now FROM runway_entry ORDER BY workspace_id').all();
    expect(rows).toEqual([
      { workspace_id: 'ws-a', why_now: 'A' },
      { workspace_id: 'ws-b', why_now: 'B' },
    ]);
    expect(() => insertEntry(db, 'ws-a', 'jira:DEMO-1')).toThrow(/UNIQUE constraint failed/);
  });

  it('refuses a duplicate rank in the same workspace', () => {
    insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 1 });
    expect(() => insertEntry(db, 'ws-a', 'jira:DEMO-2', { rank: 1 })).toThrow(/UNIQUE constraint failed/);
    insertEntry(db, 'ws-a', 'jira:DEMO-2', { rank: 2 });
    expect(() =>
      db.prepare(`UPDATE runway_entry SET focus_rank = 1 WHERE issue_id = ?`).run('jira:DEMO-2'),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('allows the same rank in different workspaces and many unranked entries', () => {
    insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 1 });
    insertEntry(db, 'ws-b', 'jira:DEMO-2', { rank: 1 });
    insertEntry(db, 'ws-a', 'jira:DEMO-3', { rank: null });
    insertEntry(db, 'ws-a', 'jira:DEMO-4', { rank: null, focus: 0 });
    const n = db.prepare('SELECT count(*) AS n FROM runway_entry').get() as { n: number };
    expect(n.n).toBe(4);
  });

  it('refuses ranks outside 1–3 and a rank without Focus', () => {
    expect(() => insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 0 })).toThrow(/CHECK constraint failed/);
    expect(() => insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 4 })).toThrow(/CHECK constraint failed/);
    expect(() => insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 1, focus: 0 })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('keeps Why now when Focus is cleared', () => {
    insertEntry(db, 'ws-a', 'jira:DEMO-1', { rank: 2, whyNow: 'Blocks release' });
    db.prepare(`UPDATE runway_entry SET focus = 0, focus_rank = NULL WHERE issue_id = ?`).run('jira:DEMO-1');
    const row = db.prepare('SELECT focus, focus_rank, why_now FROM runway_entry').get();
    expect(row).toEqual({ focus: 0, focus_rank: null, why_now: 'Blocks release' });
  });

  it('refuses empty keys and an invalid dismissal week', () => {
    expect(() => insertEntry(db, '', 'jira:DEMO-1')).toThrow(/CHECK constraint failed/);
    expect(() => insertEntry(db, 'ws-a', '')).toThrow(/CHECK constraint failed/);
    const dismiss = db.prepare(
      'INSERT INTO dismissal (workspace_id, issue_id, dismissed_week_of) VALUES (?, ?, ?)',
    );
    dismiss.run('ws-a', 'jira:DEMO-1', '2026-01-05');
    expect(() => dismiss.run('ws-a', 'jira:DEMO-2', '2026-13-01')).toThrow(/CHECK constraint failed/);
    expect(() => dismiss.run('ws-a', 'jira:DEMO-3', 'next week')).toThrow(/CHECK constraint failed/);
  });

  it('stores Vermilian metadata only, never issue content', () => {
    const columns = (table: string) =>
      db
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(table)
        .map((r) => (r as { name: string }).name);
    const all = [...columns('runway_entry'), ...columns('dismissal'), ...columns('runway_item')];
    for (const forbidden of ['title', 'summary', 'description', 'comment', 'body']) {
      expect(all.some((c) => c.includes(forbidden))).toBe(false);
    }
  });
});

describe('requireJiraIssueId', () => {
  it('accepts a namespaced Jira ID', () => {
    expect(requireJiraIssueId('jira:DEMO-123')).toBe('jira:DEMO-123');
  });

  it('rejects YouTrack, bare and malformed IDs', () => {
    expect(() => requireJiraIssueId('yt:DEMO-123')).toThrow(/Jira issues only/);
    expect(() => requireJiraIssueId('DEMO-123')).toThrow(/Malformed/);
    expect(() => requireJiraIssueId('jira:demo-1')).toThrow(/Malformed/);
  });
});

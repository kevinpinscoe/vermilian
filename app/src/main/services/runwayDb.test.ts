import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RUNWAY_APPLICATION_ID,
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
  it('creates a new database with schema v1 and identifying pragmas', () => {
    const db = openRunwayDb(dbPath);
    expect(pragma(db, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
    expect(pragma(db, 'user_version')).toBe(RUNWAY_SCHEMA_VERSION);
    expect(pragma(db, 'integrity_check')).toBe('ok');
    const tables = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(['dismissal', 'runway_entry']);
    db.close();
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
    const all = [...columns('runway_entry'), ...columns('dismissal')];
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

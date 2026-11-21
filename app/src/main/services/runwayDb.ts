// Runway metadata database, schema v2 (ADR-0011 §6, ADR-0012).
//
// Jira-backed workspaces keep their Priority Desk ("Project Runway") metadata
// in a local SQLite file, because Jira has no place for Vermilian's Focus,
// Focus rank, Why now or "Not this week" dismissals. YouTrack workspaces are
// unaffected: their metadata stays in YouTrack custom fields (ADR-0007).
//
// Rules this schema enforces:
//   - every row is keyed by stable workspace ID AND provider-qualified issue
//     ID (`jira:DEMO-123`, see shared/tracker.ts), so the same key in two
//     workspaces never shares data;
//   - at most one issue per rank per workspace (partial unique index);
//   - ranks are 1–3 and imply Focus; clearing Focus keeps Why now (ADR-0007);
//   - it holds Vermilian's own metadata only — never issue titles,
//     descriptions or comments, which are always fetched live from Jira;
//   - PRAGMA application_id identifies the file as a Vermilian Runway
//     database, and PRAGMA user_version records the schema version.
//
// Schema v2 (VERM-78) adds `runway_item`, the Workspace Runway order: one row
// per ticket, section or note, numbered 1..N per workspace. It is additive —
// `runway_entry` and `dismissal` are unchanged — and unlike the Desk it holds
// YouTrack (`yt:`) as well as Jira (`jira:`) tickets. A v1 file is migrated on
// first open, after a verified copy of it is written to `runway-backups`; if
// that copy cannot be written the file is left at v1, untouched.
//
// Uses Node's built-in `node:sqlite` (verified in the packaged app on every
// release platform by .github/workflows/sqlite-packaged-check.yml). No
// Electron import, so it runs under vitest; callers pass the file path.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseIssueId, type NamespacedIssueId } from '../../shared/tracker';

/** File name inside Vermilian's user-data directory. */
export const RUNWAY_DB_FILENAME = 'runway-metadata.sqlite';

/** PRAGMA application_id for a Vermilian Runway database: ASCII "VRML". */
export const RUNWAY_APPLICATION_ID = 0x5652_4d4c;

/** Schema version written to PRAGMA user_version. */
export const RUNWAY_SCHEMA_VERSION = 2;

/**
 * Directory beside the database holding the pre-migration copy and the
 * automatic pre-import backups (VERM-51).
 */
export const RUNWAY_BACKUP_DIRNAME = 'runway-backups';

/**
 * Schema v1 DDL. Exported so the snapshot import (VERM-51) can compare a
 * snapshot's schema with exactly what this version creates.
 */
export const RUNWAY_SCHEMA_V1 = `
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

/**
 * What schema v2 adds to v1: the Workspace Runway order (VERM-78). `item_id`
 * is a namespaced ticket ID (`yt:…` / `jira:…`) or `sec:` / `note:` plus a
 * UUID; `text` is a section title or note body, NULL for tickets.
 */
export const RUNWAY_SCHEMA_V2_ADDITIONS = `
CREATE TABLE runway_item (
  workspace_id TEXT    NOT NULL CHECK (length(workspace_id) > 0),
  item_id      TEXT    NOT NULL CHECK (length(item_id) > 0),
  kind         TEXT    NOT NULL CHECK (kind IN ('issue', 'section', 'note')),
  position     INTEGER NOT NULL CHECK (position >= 1),
  depth        INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 4),
  text         TEXT,
  added_at     TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  PRIMARY KEY (workspace_id, item_id)
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX runway_item_position
  ON runway_item (workspace_id, position);
`;

/** The complete schema v2 DDL: v1 plus the v2 additions. */
export const RUNWAY_SCHEMA_V2 = RUNWAY_SCHEMA_V1 + RUNWAY_SCHEMA_V2_ADDITIONS;

/** The tables each schema version holds. */
export const RUNWAY_V1_TABLES = ['runway_entry', 'dismissal'] as const;

export type RunwayDbErrorCode =
  | 'not-a-database' // the file is not SQLite at all
  | 'foreign-database' // SQLite, but not a Vermilian Runway database
  | 'newer-schema' // written by a newer Vermilian; refuse rather than guess
  | 'incomplete-schema' // Vermilian's application_id but no schema version, or missing tables
  | 'migration-backup-failed'; // the pre-migration copy failed; the file is still v1

export class RunwayDbError extends Error {
  constructor(
    readonly code: RunwayDbErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwayDbError';
  }
}

function pragmaInt(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return Number(row ? Object.values(row)[0] : 0);
}

function objectCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT count(*) AS n FROM sqlite_schema').get() as { n: number };
  return Number(row.n);
}

type HeaderState = 'empty' | 'v1' | 'current';

// Checks the header of an open database: 'empty' needs the schema, 'v1'
// needs the v2 migration, 'current' is ready. Throws when it must not be used.
function checkHeader(db: DatabaseSync, path: string): HeaderState {
  const appId = pragmaInt(db, 'application_id');
  const version = pragmaInt(db, 'user_version');
  if (appId === 0 && version === 0) {
    if (objectCount(db) > 0) {
      throw new RunwayDbError('foreign-database', `Not a Vermilian Runway database: ${path}`);
    }
    return 'empty';
  }
  if (appId !== RUNWAY_APPLICATION_ID) {
    throw new RunwayDbError('foreign-database', `Not a Vermilian Runway database: ${path}`);
  }
  if (version > RUNWAY_SCHEMA_VERSION) {
    throw new RunwayDbError(
      'newer-schema',
      `Runway database schema v${version} is newer than this version of Vermilian supports (v${RUNWAY_SCHEMA_VERSION}): ${path}`,
    );
  }
  if (version < 1) {
    throw new RunwayDbError('incomplete-schema', `Runway database has no schema version: ${path}`);
  }
  if (version === 1) {
    const missing = RUNWAY_V1_TABLES.filter((t) => !hasTable(db, t));
    if (missing.length > 0) {
      throw new RunwayDbError(
        'incomplete-schema',
        `Runway database v1 is missing ${missing.join(', ')}: ${path}`,
      );
    }
    return 'v1';
  }
  return 'current';
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function tableCount(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

// ─── Pre-migration copy ─────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * `runway-pre-v2-migration-YYYYMMDD-HHMMSS[-N].sqlite` in local time. The
 * name deliberately differs from the pre-import backups, so their retention
 * never removes the pre-migration copy.
 */
export function preMigrationFileName(now: Date, sequence = 1): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `runway-pre-v2-migration-${stamp}${sequence > 1 ? `-${sequence}` : ''}.sqlite`;
}

/**
 * Checks a pre-migration copy against the live v1 database: intact, a v1
 * Vermilian Runway file, and holding the same number of rows in every v1
 * table. Throws when it does not.
 */
export function verifyPreMigrationCopy(copyPath: string, live: DatabaseSync): void {
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  try {
    const integrity = copy.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
    if (Object.values(integrity)[0] !== 'ok') throw new Error('integrity_check failed');
    if (pragmaInt(copy, 'application_id') !== RUNWAY_APPLICATION_ID) {
      throw new Error('copy has the wrong application_id');
    }
    if (pragmaInt(copy, 'user_version') !== 1) {
      throw new Error('copy is not schema v1');
    }
    for (const table of RUNWAY_V1_TABLES) {
      const want = tableCount(live, table);
      const got = tableCount(copy, table);
      if (got !== want) throw new Error(`copy holds ${got} ${table} rows, the database ${want}`);
    }
  } finally {
    copy.close();
  }
}

// Writes a consistent copy of the open v1 database with VACUUM INTO, under a
// name nothing else holds, and verifies it. VACUUM INTO refuses an existing
// destination, so a name taken in a race moves on to the next sequence
// number and nothing is ever overwritten. A copy that fails verification is
// removed. Any failure is a 'migration-backup-failed' error.
function writePreMigrationCopy(db: DatabaseSync, path: string, opts: Required<OpenRunwayDbOptions>): string {
  try {
    mkdirSync(opts.backupDir, { recursive: true });
    const now = opts.now();
    for (let sequence = 1; sequence <= 1000; sequence++) {
      const copyPath = join(opts.backupDir, preMigrationFileName(now, sequence));
      if (existsSync(copyPath)) continue;
      try {
        db.prepare('VACUUM INTO ?').run(copyPath);
      } catch (err) {
        if (existsSync(copyPath) && /exists/i.test(String(err))) continue;
        throw err;
      }
      try {
        opts.verifyBackup(copyPath, db);
      } catch (err) {
        rmSync(copyPath, { force: true });
        throw err;
      }
      return copyPath;
    }
    throw new Error(`no free file name in ${opts.backupDir}`);
  } catch (err) {
    throw new RunwayDbError(
      'migration-backup-failed',
      `Could not write the pre-migration copy of ${path}, so it was left at schema v1: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

export interface OpenRunwayDbOptions {
  /** Where the pre-migration copy goes. Default: `runway-backups` beside the file. */
  backupDir?: string;
  /** Clock for the copy's file name. */
  now?: () => Date;
  /** Verifies the copy before migrating. Replaceable for tests only. */
  verifyBackup?: (copyPath: string, live: DatabaseSync) => void;
}

/**
 * Opens the Runway database at `path`, creating it with schema v2 if the file
 * is missing or empty, and migrating a v1 file to v2 after writing a verified
 * pre-migration copy. Refuses — without modifying the file — anything that is
 * not SQLite, not a Vermilian Runway database, or written by a newer schema,
 * and leaves a v1 file at v1 if its copy cannot be written. The caller owns
 * the returned handle and must close it.
 */
export function openRunwayDb(path: string, options: OpenRunwayDbOptions = {}): DatabaseSync {
  const opts: Required<OpenRunwayDbOptions> = {
    backupDir: options.backupDir ?? join(dirname(path), RUNWAY_BACKUP_DIRNAME),
    now: options.now ?? (() => new Date()),
    verifyBackup: options.verifyBackup ?? verifyPreMigrationCopy,
  };
  const db = new DatabaseSync(path);
  try {
    const state = checkHeader(db, path);
    // VACUUM INTO cannot run inside a transaction, so the copy is taken
    // first. The migration only adds a table, so a Desk write landing
    // between the copy and the lock loses nothing.
    if (state === 'v1') writePreMigrationCopy(db, path, opts);
    if (state !== 'current') {
      // BEGIN IMMEDIATE takes the write lock, then the header is re-checked so
      // two openers cannot both create or migrate the schema.
      db.exec('BEGIN IMMEDIATE');
      try {
        const locked = checkHeader(db, path);
        if (locked === 'empty') {
          db.exec(RUNWAY_SCHEMA_V2);
          db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
        } else if (locked === 'v1') {
          db.exec(RUNWAY_SCHEMA_V2_ADDITIONS);
        }
        if (locked !== 'current') db.exec(`PRAGMA user_version = ${RUNWAY_SCHEMA_VERSION}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    return db;
  } catch (err) {
    db.close();
    if (err instanceof RunwayDbError) throw err;
    if (err instanceof Error && /not a database/i.test(err.message)) {
      throw new RunwayDbError('not-a-database', `Not an SQLite database: ${path}`);
    }
    throw err;
  }
}

/**
 * Returns `id` when it is a namespaced Jira issue ID (`jira:DEMO-123`).
 * Only Jira issues have Runway metadata in this database; YouTrack issues keep
 * theirs in YouTrack, so a `yt:` or bare ID here is a caller bug.
 */
export function requireJiraIssueId(id: string): NamespacedIssueId {
  if (parseIssueId(id).kind !== 'jira') {
    throw new Error(`Runway database holds Jira issues only, got ${JSON.stringify(id)}`);
  }
  return id as NamespacedIssueId;
}

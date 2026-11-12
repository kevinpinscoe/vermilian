// Runway metadata database, schema v1 (ADR-0011 §6).
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
// Uses Node's built-in `node:sqlite` (verified in the packaged app on every
// release platform by .github/workflows/sqlite-packaged-check.yml). No
// Electron import, so it runs under vitest; callers pass the file path.

import { DatabaseSync } from 'node:sqlite';
import { parseIssueId, type NamespacedIssueId } from '../../shared/tracker';

/** File name inside Vermilian's user-data directory. */
export const RUNWAY_DB_FILENAME = 'runway-metadata.sqlite';

/** PRAGMA application_id for a Vermilian Runway database: ASCII "VRML". */
export const RUNWAY_APPLICATION_ID = 0x5652_4d4c;

/** Schema version written to PRAGMA user_version. */
export const RUNWAY_SCHEMA_VERSION = 1;

const SCHEMA_V1 = `
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

export type RunwayDbErrorCode =
  | 'not-a-database' // the file is not SQLite at all
  | 'foreign-database' // SQLite, but not a Vermilian Runway database
  | 'newer-schema' // written by a newer Vermilian; refuse rather than guess
  | 'incomplete-schema'; // Vermilian's application_id but no schema version

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

// Checks the header of an open database. Returns true when the file is empty
// and still needs the schema; throws when it must not be used.
function checkHeader(db: DatabaseSync, path: string): boolean {
  const appId = pragmaInt(db, 'application_id');
  const version = pragmaInt(db, 'user_version');
  if (appId === 0 && version === 0) {
    if (objectCount(db) > 0) {
      throw new RunwayDbError('foreign-database', `Not a Vermilian Runway database: ${path}`);
    }
    return true;
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
  return false;
}

/**
 * Opens the Runway database at `path`, creating it with schema v1 if the file
 * is missing or empty. Refuses — without modifying the file — anything that
 * is not SQLite, not a Vermilian Runway database, or written by a newer
 * schema. The caller owns the returned handle and must close it.
 */
export function openRunwayDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    if (checkHeader(db, path)) {
      // BEGIN IMMEDIATE takes the write lock, then the header is re-checked so
      // two openers cannot both create the schema.
      db.exec('BEGIN IMMEDIATE');
      try {
        if (checkHeader(db, path)) {
          db.exec(SCHEMA_V1);
          db.exec(`PRAGMA application_id = ${RUNWAY_APPLICATION_ID}`);
          db.exec(`PRAGMA user_version = ${RUNWAY_SCHEMA_VERSION}`);
        }
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

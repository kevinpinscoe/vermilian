// Runway metadata snapshot import (VERM-51, ADR-0011 §7).
//
// Restores a whole-database snapshot written by the VERM-50 export into the
// live Runway database, replacing every workspace's Jira Runway metadata.
// Nothing is written to Jira or YouTrack.
//
// The sequence, each step gating the next:
//
//   1. Stage. The chosen file is read ONCE into memory and written to a
//      private staging file in userData. Everything after this works on that
//      private copy, so a file swapped or edited at the chosen path cannot
//      reach the live database. The user's file is never opened by SQLite,
//      so not even a journal is created beside it.
//   2. Validate the staged copy (read-only): integrity_check, the Runway
//      application_id, a schema version this build reads (exactly the
//      current one — nothing is migrated or reinterpreted), a schema identical
//      to the one this build creates, Jira-only issue IDs, and a dry run that
//      inserts every row into an empty in-memory database with the live
//      schema, so every CHECK and the one-issue-per-rank index are proven.
//   3. The user sees a preview and confirms (renderer).
//   4. Revalidate: the chosen file must still hash to what was previewed and
//      the staged copy must still validate to the same content.
//   5. Back up the live database with the VERM-50 export (online backup,
//      verified, published by hard link) into userData/runway-backups. If the
//      backup fails, nothing is changed.
//   6. Replace in ONE transaction on the existing live connection:
//      ATTACH the staged copy, BEGIN IMMEDIATE, confirm the live rows still
//      equal the backup (so the backup is exactly the state replaced), DELETE
//      every row, INSERT … SELECT every snapshot row (re-checked by the live
//      constraints), confirm the result equals the snapshot, COMMIT. Any
//      failure rolls the whole transaction back. DETACH afterwards.
//   7. Verify after commit (integrity_check + content fingerprint), then keep
//      the newest RUNWAY_BACKUP_KEEP automatic backups.
//
// Steps 5–7 run inside a RunwayWriteGate that Runway writes also go through,
// so no write can land between the backup and the replacement. The
// fingerprint check in step 6 is the backstop if one somehow does.
//
// No Electron import, so it runs under vitest; the IPC handler owns dialogs.

import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeIssueId } from '../../shared/tracker';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_V1, RUNWAY_SCHEMA_VERSION } from './runwayDb';
import {
  RUNWAY_SNAPSHOT_TABLES,
  RunwaySnapshotError,
  exportRunwaySnapshot,
  runwayRowCounts,
  type RunwaySnapshotSummary,
} from './runwaySnapshot';

type RunwayTable = (typeof RUNWAY_SNAPSHOT_TABLES)[number];

/** Every column of each table, in a fixed order, for copying and fingerprints. */
const TABLE_COLUMNS: Record<RunwayTable, readonly string[]> = {
  runway_entry: ['workspace_id', 'issue_id', 'focus', 'focus_rank', 'why_now', 'deferred', 'updated_at'],
  dismissal: ['workspace_id', 'issue_id', 'dismissed_week_of'],
};

/** Directory in userData holding the automatic pre-import backups. */
export const RUNWAY_BACKUP_DIRNAME = 'runway-backups';
/** Directory in userData holding the private copy of a previewed snapshot. */
export const RUNWAY_IMPORT_STAGING_DIRNAME = 'runway-import-staging';
/** Automatic pre-import backups kept after a successful import. */
export const RUNWAY_BACKUP_KEEP = 10;
/** Largest snapshot accepted; real ones are kilobytes. */
export const RUNWAY_SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

/** Schema name the staged snapshot is attached under during the replace. */
const ATTACHED = 'runway_import';

export type RunwayImportErrorCode =
  | 'invalid-source' // not an absolute path to a readable regular file, or too large
  | 'not-a-database' // not SQLite at all
  | 'integrity-failed' // PRAGMA integrity_check did not return ok
  | 'foreign-database' // SQLite, but not a Vermilian Runway database
  | 'newer-schema' // written by a newer Vermilian
  | 'unsupported-schema' // an older or missing schema version this build does not import
  | 'schema-mismatch' // right version, but tables/indexes differ from this build's schema
  | 'invalid-data' // a row breaks a Runway rule (non-Jira ID, rank, date, ...)
  | 'no-preview' // confirm without a matching preview
  | 'import-in-progress' // an import is already running (refused in the main process)
  | 'snapshot-changed' // the chosen file or the staged copy changed after the preview
  | 'backup-failed' // the pre-import backup could not be written; nothing changed
  | 'busy' // another connection holds the database; nothing changed
  | 'live-changed' // live data changed after the backup; nothing changed
  | 'import-failed' // the replacement failed and was rolled back; nothing changed
  | 'verification-failed'; // committed, but the post-import check failed: restore the backup

export class RunwayImportError extends Error {
  constructor(
    readonly code: RunwayImportErrorCode,
    message: string,
    /** The pre-import backup, when one was written before the failure. */
    readonly backupPath?: string,
  ) {
    super(message);
    this.name = 'RunwayImportError';
  }
}

export interface RunwaySnapshotInspection {
  schemaVersion: number;
  rowCounts: Record<string, number>;
  /** SHA-256 over every row of every table, in primary-key order. */
  fingerprint: string;
}

export interface StagedRunwaySnapshot extends RunwaySnapshotInspection {
  /** Identifies this preview; the confirm must present it. */
  token: string;
  /** The file the user chose. */
  sourcePath: string;
  /** The private copy that is validated and imported. */
  stagedPath: string;
  /** SHA-256 of the chosen file's bytes as read at preview time. */
  sourceSha256: string;
  /** Filesystem modification time of the chosen file (ISO 8601). File metadata, NOT an export time. */
  fileModifiedAt: string;
  sizeBytes: number;
}

export interface RunwayImportResult {
  backupPath: string;
  /** Rows per table after the import (equal to the snapshot's). */
  rowCounts: Record<string, number>;
  /** Rows per table that were replaced. */
  previousRowCounts: Record<string, number>;
  /** Backup file names removed by retention. */
  prunedBackups: string[];
  /** Set when retention failed; the import itself succeeded. */
  pruneWarning?: string;
}

// ─── Fingerprints and helpers ───────────────────────────────────────────────

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function pragmaValues(db: DatabaseSync, pragma: string): unknown[] {
  return (db.prepare(`PRAGMA ${pragma}`).all() as Record<string, unknown>[]).map((row) => Object.values(row)[0]);
}

/**
 * A SHA-256 over every row of every Runway table in `schema` ('main' or an
 * attached name), in primary-key order. Two databases with the same
 * fingerprint hold exactly the same Runway metadata.
 */
export function runwayFingerprint(db: DatabaseSync, schema = 'main'): string {
  const hash = createHash('sha256');
  for (const table of RUNWAY_SNAPSHOT_TABLES) {
    const columns = TABLE_COLUMNS[table];
    hash.update(`${table}\n`);
    const rows = db
      .prepare(`SELECT ${columns.join(', ')} FROM ${schema}.${table} ORDER BY workspace_id, issue_id`)
      .all() as Record<string, unknown>[];
    for (const row of rows) hash.update(`${JSON.stringify(columns.map((c) => row[c]))}\n`);
  }
  return hash.digest('hex');
}

/** Removes a SQLite file and any side files it may have left. */
function removeDatabaseFiles(path: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isBusy(err: unknown): boolean {
  const e = err as { errcode?: number; message?: string };
  return e?.errcode === 5 || e?.errcode === 6 || /database (table )?is locked|SQLITE_BUSY/i.test(e?.message ?? '');
}

// The user-defined objects of a database's schema, normalised for comparison.
function schemaObjects(db: DatabaseSync, schema = 'main'): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM ${schema}.sqlite_schema
       WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name`,
    )
    .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;
  return rows.map((r) => `${r.type} ${r.name} ON ${r.tbl_name}: ${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
}

let expectedSchemaCache: string[] | undefined;
function expectedSchema(): string[] {
  if (!expectedSchemaCache) {
    const mem = new DatabaseSync(':memory:');
    try {
      mem.exec(RUNWAY_SCHEMA_V1);
      expectedSchemaCache = schemaObjects(mem);
    } finally {
      mem.close();
    }
  }
  return expectedSchemaCache;
}

// ─── Validation ─────────────────────────────────────────────────────────────

// Inserts every snapshot row into an empty in-memory database with the live
// schema, so the live CHECKs, STRICT types and the rank index judge the data
// before the live database is touched.
function dryRunInsert(path: string): void {
  const mem = new DatabaseSync(':memory:');
  try {
    mem.exec(RUNWAY_SCHEMA_V1);
    mem.prepare(`ATTACH DATABASE ? AS ${ATTACHED}`).run(path);
    try {
      for (const table of RUNWAY_SNAPSHOT_TABLES) {
        const cols = TABLE_COLUMNS[table].join(', ');
        mem.exec(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM ${ATTACHED}.${table}`);
      }
    } finally {
      mem.exec(`DETACH DATABASE ${ATTACHED}`);
    }
  } catch (err) {
    throw new RunwayImportError('invalid-data', `Snapshot breaks a Runway rule: ${messageOf(err)}`);
  } finally {
    mem.close();
  }
}

/**
 * Opens `path` read-only and checks that it is a complete, valid Runway
 * database this version can import. Throws RunwayImportError otherwise.
 * Never writes to `path`.
 */
export function inspectRunwaySnapshot(path: string): RunwaySnapshotInspection {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const integrity = pragmaValues(db, 'integrity_check');
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new RunwayImportError(
        'integrity-failed',
        `Snapshot failed integrity_check: ${integrity.slice(0, 3).map(String).join('; ')}`,
      );
    }
    if (pragmaValues(db, 'application_id')[0] !== RUNWAY_APPLICATION_ID) {
      throw new RunwayImportError('foreign-database', 'This file is not a Vermilian Runway snapshot');
    }
    const schemaVersion = Number(pragmaValues(db, 'user_version')[0]);
    if (schemaVersion > RUNWAY_SCHEMA_VERSION) {
      throw new RunwayImportError(
        'newer-schema',
        `Snapshot schema v${schemaVersion} is newer than this version of Vermilian supports ` +
          `(v${RUNWAY_SCHEMA_VERSION}); update Vermilian to import it`,
      );
    }
    if (schemaVersion !== RUNWAY_SCHEMA_VERSION) {
      throw new RunwayImportError(
        'unsupported-schema',
        `Snapshot schema v${schemaVersion} cannot be imported by this version (v${RUNWAY_SCHEMA_VERSION})`,
      );
    }
    const actual = schemaObjects(db);
    const expected = expectedSchema();
    if (actual.length !== expected.length || actual.some((obj, i) => obj !== expected[i])) {
      const extra = actual.filter((o) => !expected.includes(o)).map((o) => o.split(':')[0]);
      const missing = expected.filter((o) => !actual.includes(o)).map((o) => o.split(':')[0]);
      throw new RunwayImportError(
        'schema-mismatch',
        `Snapshot schema does not match Runway schema v${RUNWAY_SCHEMA_VERSION}` +
          (missing.length ? `; missing or different: ${missing.join(', ')}` : '') +
          (extra.length ? `; unexpected: ${extra.join(', ')}` : ''),
      );
    }
    for (const table of RUNWAY_SNAPSHOT_TABLES) {
      const ids = db.prepare(`SELECT issue_id FROM ${table}`).all() as Array<{ issue_id: unknown }>;
      const bad = ids.find((r) => decodeIssueId(r.issue_id)?.kind !== 'jira');
      if (bad) {
        throw new RunwayImportError(
          'invalid-data',
          `Snapshot ${table} holds a non-Jira issue ID ${JSON.stringify(bad.issue_id)}`,
        );
      }
    }
    dryRunInsert(path);
    return { schemaVersion, rowCounts: runwayRowCounts(db), fingerprint: runwayFingerprint(db) };
  } catch (err) {
    if (err instanceof RunwayImportError) throw err;
    const message = messageOf(err);
    if (/not a database|file is encrypted|malformed/i.test(message)) {
      throw new RunwayImportError('not-a-database', 'This file is not an SQLite database');
    }
    throw new RunwayImportError('invalid-source', `Snapshot could not be read: ${message}`);
  } finally {
    db?.close();
  }
}

// ─── Staging ────────────────────────────────────────────────────────────────

/**
 * Reads the chosen snapshot once, writes a private copy into `stagingDir`,
 * and validates the copy. Returns what the preview shows and the confirm
 * needs. On failure no staged file is left behind.
 */
export function stageRunwaySnapshot(sourcePath: string, stagingDir: string): StagedRunwaySnapshot {
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) {
    throw new RunwayImportError('invalid-source', 'Choose a Runway snapshot file to import');
  }
  let info;
  try {
    info = statSync(sourcePath);
  } catch (err) {
    throw new RunwayImportError('invalid-source', `Cannot read ${sourcePath}: ${messageOf(err)}`);
  }
  if (!info.isFile()) throw new RunwayImportError('invalid-source', `${sourcePath} is not a file`);
  if (info.size > RUNWAY_SNAPSHOT_MAX_BYTES) {
    throw new RunwayImportError('invalid-source', `${sourcePath} is too large to be a Runway snapshot`);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(sourcePath);
  } catch (err) {
    throw new RunwayImportError('invalid-source', `Cannot read ${sourcePath}: ${messageOf(err)}`);
  }

  mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(16).toString('hex');
  const stagedPath = join(stagingDir, `${token}.sqlite`);
  writeFileSync(stagedPath, bytes, { flag: 'wx', mode: 0o600 });
  try {
    const inspection = inspectRunwaySnapshot(stagedPath);
    return {
      ...inspection,
      token,
      sourcePath,
      stagedPath,
      sourceSha256: sha256(bytes),
      fileModifiedAt: info.mtime.toISOString(),
      sizeBytes: bytes.length,
    };
  } catch (err) {
    removeDatabaseFiles(stagedPath);
    throw err;
  }
}

/** Removes a staged copy. Safe to call more than once. */
export function discardStagedSnapshot(staged: StagedRunwaySnapshot | null | undefined): void {
  if (staged) removeDatabaseFiles(staged.stagedPath);
}

const STAGED_NAME = /^[0-9a-f]{32}\.sqlite(-journal|-wal|-shm)?$/;

/**
 * Removes leftover staged copies (e.g. after a crash). Touches nothing else,
 * and never a file whose base name (`<token>.sqlite`) is in `keep` — the
 * active import's staged copy and its side files.
 */
export function clearRunwayImportStaging(stagingDir: string, keep: readonly string[] = []): void {
  let entries;
  try {
    entries = readdirSync(stagingDir, { withFileTypes: true });
  } catch {
    return; // no staging directory yet
  }
  for (const entry of entries) {
    if (!entry.isFile() || !STAGED_NAME.test(entry.name)) continue;
    if (keep.some((name) => entry.name === name || entry.name.startsWith(`${name}-`))) continue;
    rmSync(join(stagingDir, entry.name), { force: true });
  }
}

// Step 4: the chosen file must be byte-identical to what was previewed and
// the staged copy must still validate to the same content.
function revalidate(staged: StagedRunwaySnapshot): void {
  let current: Buffer;
  try {
    current = readFileSync(staged.sourcePath);
  } catch {
    throw new RunwayImportError(
      'snapshot-changed',
      `Nothing was imported: ${staged.sourcePath} is no longer readable since it was previewed`,
    );
  }
  if (sha256(current) !== staged.sourceSha256) {
    throw new RunwayImportError(
      'snapshot-changed',
      `Nothing was imported: ${staged.sourcePath} changed after it was previewed. Choose it again to preview its new contents.`,
    );
  }
  let again: RunwaySnapshotInspection;
  try {
    again = inspectRunwaySnapshot(staged.stagedPath);
  } catch (err) {
    throw new RunwayImportError('snapshot-changed', `Nothing was imported: the staged snapshot no longer validates (${messageOf(err)})`);
  }
  if (again.fingerprint !== staged.fingerprint) {
    throw new RunwayImportError('snapshot-changed', 'Nothing was imported: the staged snapshot changed after it was previewed');
  }
}

// ─── Backups and retention ──────────────────────────────────────────────────

const BACKUP_NAME = /^runway-before-import-(\d{8})-(\d{6})(?:-(\d+))?\.sqlite$/;

/** `runway-before-import-YYYYMMDD-HHMMSS[-N].sqlite` in local time. */
export function backupFileName(now: Date, sequence = 1): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `runway-before-import-${stamp}${sequence > 1 ? `-${sequence}` : ''}.sqlite`;
}

type ExportFn = (source: DatabaseSync, destination: string) => Promise<RunwaySnapshotSummary>;

// Writes a verified backup under a name nothing else holds. The export
// refuses an existing destination atomically, so a name taken in a race
// just moves on to the next sequence number; nothing is ever overwritten.
async function writeBackup(live: DatabaseSync, dir: string, now: Date, exportFn: ExportFn): Promise<string> {
  for (let sequence = 1; sequence <= 1000; sequence++) {
    const path = join(dir, backupFileName(now, sequence));
    try {
      await exportFn(live, path);
      return path;
    } catch (err) {
      if (err instanceof RunwaySnapshotError && err.code === 'destination-exists') continue;
      throw err;
    }
  }
  throw new Error(`No free backup file name in ${dir}`);
}

/**
 * Keeps the newest `keep` automatic pre-import backups in `dir` and removes
 * older ones. Only regular files named like an automatic backup are
 * considered: manual exports, other files, symbolic links and directories are
 * never touched, and `protect` (the backup just written) is never removed.
 * Returns the names removed.
 */
export function pruneRunwayBackups(dir: string, keep: number, protect?: string): string[] {
  const backups = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, match: BACKUP_NAME.exec(entry.name) }))
    .filter((b): b is { name: string; match: RegExpExecArray } => b.match !== null)
    .map(({ name, match }) => ({ name, key: `${match[1]}${match[2]}`, sequence: Number(match[3] ?? 1) }))
    // Newest first: by timestamp, then by same-second sequence number.
    .sort((a, b) => (a.key === b.key ? b.sequence - a.sequence : a.key < b.key ? 1 : -1));

  const protectedName = protect ? basename(protect) : undefined;
  const removed: string[] = [];
  let kept = 0;
  for (const backup of backups) {
    if (backup.name === protectedName || kept < keep) {
      kept++;
      continue;
    }
    const path = join(dir, backup.name);
    // Re-check right before removal: a regular file, never a link or directory.
    if (!lstatSync(path).isFile()) continue;
    rmSync(path);
    removed.push(backup.name);
  }
  return removed;
}

// ─── Import ─────────────────────────────────────────────────────────────────

/** Test-only fault injection points. */
export interface RunwayImportHooks {
  /** After the backup is written, before the replacement transaction. */
  afterBackup?(): void | Promise<void>;
  /** Inside the transaction, after the live rows are deleted. */
  afterDelete?(): void;
  /** After COMMIT, before the post-import verification. */
  afterCommit?(): void;
}

export interface ImportRunwaySnapshotOptions {
  /** Directory for the automatic pre-import backup (userData/runway-backups). */
  backupDir: string;
  /** Backups kept after a successful import (default RUNWAY_BACKUP_KEEP). */
  keep?: number;
  now?: () => Date;
  /** The backup writer; the VERM-50 export unless a test replaces it. */
  exportSnapshot?: ExportFn;
  /** Backup retention; pruneRunwayBackups unless a test replaces it. */
  pruneBackups?: typeof pruneRunwayBackups;
  hooks?: RunwayImportHooks;
}

// Step 6: the whole replacement in one IMMEDIATE transaction. Synchronous
// from ATTACH to DETACH, so no other JavaScript can run in between.
function replaceTransactionally(
  live: DatabaseSync,
  staged: StagedRunwaySnapshot,
  backupFingerprint: string,
  backupPath: string,
  hooks: RunwayImportHooks,
): void {
  live.prepare(`ATTACH DATABASE ? AS ${ATTACHED}`).run(staged.stagedPath);
  try {
    try {
      live.exec('BEGIN IMMEDIATE');
    } catch (err) {
      throw isBusy(err)
        ? new RunwayImportError('busy', 'Nothing was imported: the Runway database is busy; try again', backupPath)
        : err;
    }
    try {
      if (runwayFingerprint(live, 'main') !== backupFingerprint) {
        throw new RunwayImportError(
          'live-changed',
          'Nothing was imported: Runway data changed while the backup was being written; try again',
          backupPath,
        );
      }
      for (const table of RUNWAY_SNAPSHOT_TABLES) live.exec(`DELETE FROM main.${table}`);
      hooks.afterDelete?.();
      for (const table of RUNWAY_SNAPSHOT_TABLES) {
        const cols = TABLE_COLUMNS[table].join(', ');
        live.exec(`INSERT INTO main.${table} (${cols}) SELECT ${cols} FROM ${ATTACHED}.${table}`);
      }
      if (runwayFingerprint(live, 'main') !== staged.fingerprint) {
        throw new Error('the restored rows do not match the snapshot');
      }
      live.exec('COMMIT');
    } catch (err) {
      try {
        live.exec('ROLLBACK');
      } catch {
        // SQLite already rolled the transaction back (e.g. on SQLITE_FULL).
      }
      if (err instanceof RunwayImportError) throw err;
      if (isBusy(err)) {
        throw new RunwayImportError('busy', 'Nothing was imported: the Runway database is busy; try again', backupPath);
      }
      throw new RunwayImportError(
        'import-failed',
        `Nothing was imported; the Runway database is unchanged: ${messageOf(err)}`,
        backupPath,
      );
    }
  } finally {
    live.exec(`DETACH DATABASE ${ATTACHED}`);
  }
}

/**
 * Replaces the live Runway database's contents with the staged snapshot.
 * Revalidates the snapshot, writes and verifies a backup, replaces in one
 * transaction, verifies, then applies backup retention. Rejects with a
 * RunwayImportError; every code except 'verification-failed' means the live
 * data is unchanged. Callers must run this inside the RunwayWriteGate.
 */
export async function importRunwaySnapshot(
  live: DatabaseSync,
  staged: StagedRunwaySnapshot,
  {
    backupDir,
    keep = RUNWAY_BACKUP_KEEP,
    now = () => new Date(),
    exportSnapshot = exportRunwaySnapshot,
    pruneBackups = pruneRunwayBackups,
    hooks = {},
  }: ImportRunwaySnapshotOptions,
): Promise<RunwayImportResult> {
  revalidate(staged);

  let backupPath: string;
  let backupFingerprint: string;
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    backupPath = await writeBackup(live, backupDir, now(), exportSnapshot);
    // The export verified the copy; its fingerprint ties it to the state replaced.
    const copy = new DatabaseSync(backupPath, { readOnly: true });
    try {
      backupFingerprint = runwayFingerprint(copy);
    } finally {
      copy.close();
    }
  } catch (err) {
    throw new RunwayImportError(
      'backup-failed',
      `Nothing was imported: the backup of the current Runway data could not be written (${messageOf(err)})`,
    );
  }

  await hooks.afterBackup?.();

  const previousRowCounts = runwayRowCounts(live);
  replaceTransactionally(live, staged, backupFingerprint, backupPath, hooks);
  hooks.afterCommit?.();

  // Step 7: report success only when the committed data checks out.
  const integrity = pragmaValues(live, 'main.integrity_check');
  const fingerprint = runwayFingerprint(live, 'main');
  if (integrity.length !== 1 || integrity[0] !== 'ok' || fingerprint !== staged.fingerprint) {
    throw new RunwayImportError(
      'verification-failed',
      'The snapshot was imported but the result did not verify. Your previous Runway data is in the ' +
        `backup ${backupPath}; restore it with Settings → Advanced → Import Runway snapshot…`,
      backupPath,
    );
  }

  const result: RunwayImportResult = {
    backupPath,
    rowCounts: runwayRowCounts(live),
    previousRowCounts,
    prunedBackups: [],
  };
  try {
    result.prunedBackups = pruneBackups(backupDir, keep, backupPath);
  } catch (err) {
    result.pruneWarning = `Old Runway backups could not be cleaned up: ${messageOf(err)}`;
  }
  return result;
}

// ─── Write gate ─────────────────────────────────────────────────────────────

/**
 * Runs Runway database operations one at a time, in arrival order. The
 * import holds it from revalidation to verification; Runway writes go
 * through it too, so a write arriving mid-import waits until it finishes.
 */
export class RunwayWriteGate {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

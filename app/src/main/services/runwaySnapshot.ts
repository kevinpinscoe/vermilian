// Runway metadata snapshot export (VERM-50, ADR-0011 §6).
//
// Writes the WHOLE Runway metadata database — every workspace, every table —
// to a file the user chose, as an ordinary SQLite database with the same
// schema, application_id and user_version as the live one. That is the format
// the snapshot import (VERM-51) checks and restores, and it doubles as the
// interim manual backup of Jira Runway metadata.
//
// Since schema v2 (VERM-79) the copy also gets one table the live database
// never has, `runway_snapshot_info`, holding the computer that exported it
// and the export time, so the import can show where a snapshot came from and
// warn when this computer has newer Runway changes. It is written into the
// temporary copy before verification, so a published snapshot always has it.
//
// How the snapshot is made consistent and safe:
//   - SQLite's online backup API (node:sqlite `backup()`, verified in the
//     packaged app on every platform by VERM-49) copies the database page by
//     page from the open connection. It never copies the live file with the
//     filesystem, so a write in progress can never be captured half-done, and
//     it releases its lock between steps, so normal Runway reads and writes
//     carry on while an export runs.
//   - The copy goes to a temporary file next to the destination. It is opened
//     read-only and verified (integrity_check, application_id, user_version,
//     row counts) before it is published under the chosen name.
//   - Publishing never overwrites and never exposes a partial file: the
//     destination is refused if it exists, and the verified copy is published
//     with a hard link, which appears complete in one atomic step and fails
//     with EEXIST rather than replace a file (or symbolic link) that appeared
//     in the meantime. Where the filesystem has no hard links (FAT/exFAT
//     volumes, some network shares) the export is refused with an actionable
//     error instead of falling back to a copy, which would expose a
//     half-written file under the final name.
//   - The export only ever deletes its own temporary files, never the
//     destination. On any failure they are removed, so a failed export never
//     leaves something that looks like a valid backup.
//
// No Electron import, so it runs under vitest; the IPC handler owns the dialog.

import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, lstatSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_VERSION } from './runwayDb';

/** The data tables a schema v2 snapshot contains, with their row counts reported. */
export const RUNWAY_SNAPSHOT_TABLES = ['runway_entry', 'dismissal', 'runway_item'] as const;

export type RunwaySnapshotTable = (typeof RUNWAY_SNAPSHOT_TABLES)[number];

/**
 * Snapshot-only table (never in the live database): one row naming the
 * computer that exported the snapshot and when.
 */
export const RUNWAY_SNAPSHOT_INFO_DDL = `
CREATE TABLE runway_snapshot_info (
  singleton   INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  exported_by TEXT    NOT NULL CHECK (length(exported_by) > 0),
  exported_at TEXT    NOT NULL CHECK (length(exported_at) > 0)
) STRICT;
`;

/** Who exported a snapshot and when; both null when the snapshot does not say. */
export interface RunwaySnapshotOrigin {
  exportedBy: string | null;
  exportedAt: string | null;
}

/** Reads `runway_snapshot_info` from an open snapshot; nulls when absent or empty. */
export function readSnapshotOrigin(db: DatabaseSync, schema = 'main'): RunwaySnapshotOrigin {
  const has = db
    .prepare(`SELECT 1 FROM ${schema}.sqlite_schema WHERE type = 'table' AND name = 'runway_snapshot_info'`)
    .get();
  if (!has) return { exportedBy: null, exportedAt: null };
  const row = db.prepare(`SELECT exported_by, exported_at FROM ${schema}.runway_snapshot_info`).get() as
    | { exported_by: string; exported_at: string }
    | undefined;
  return { exportedBy: row?.exported_by ?? null, exportedAt: row?.exported_at ?? null };
}

/** This computer's name as a snapshot records it. */
export function localComputerName(): string {
  return hostname() || 'Unknown computer';
}

/** Pages copied per backup step; the lock is released between steps. */
const BACKUP_PAGES_PER_STEP = 64;

export type RunwaySnapshotErrorCode =
  | 'invalid-destination' // not an absolute path to a file
  | 'destination-exists' // never overwritten
  | 'verification-failed' // the copy did not check out; nothing was published
  | 'publication-unsupported' // the destination's filesystem has no hard links
  | 'export-failed'; // the backup or the publish step failed

export class RunwaySnapshotError extends Error {
  constructor(
    readonly code: RunwaySnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwaySnapshotError';
  }
}

export interface RunwaySnapshotSummary {
  /** Absolute path of the published snapshot. */
  path: string;
  /** ISO 8601 export time, as recorded in the snapshot. */
  exportedAt: string;
  /** The computer recorded in the snapshot as having exported it. */
  exportedBy: string;
  /** Schema version recorded in the snapshot (PRAGMA user_version). */
  schemaVersion: number;
  /** Rows per table, read back from the published copy. */
  rowCounts: Record<string, number>;
  /** Database pages copied. */
  pages: number;
}

function pragmaValue(db: DatabaseSync, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

/** Row counts for every snapshot table (or the given ones), from an open database. */
export function runwayRowCounts(
  db: DatabaseSync,
  tables: readonly string[] = RUNWAY_SNAPSHOT_TABLES,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    counts[table] = Number(row.n);
  }
  return counts;
}

/** Removes a SQLite file and any side files it may have left. */
function removeDatabaseFiles(path: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(path + suffix, { force: true });
  }
}

// Writes the snapshot-only origin row into the temporary copy.
function stampOrigin(path: string, exportedBy: string, exportedAt: string): void {
  const copy = new DatabaseSync(path);
  try {
    copy.exec('BEGIN IMMEDIATE');
    copy.exec(RUNWAY_SNAPSHOT_INFO_DDL);
    copy
      .prepare('INSERT INTO runway_snapshot_info (singleton, exported_by, exported_at) VALUES (1, ?, ?)')
      .run(exportedBy, exportedAt);
    copy.exec('COMMIT');
  } finally {
    copy.close();
  }
}

// Opens the copy read-only and checks that it is a complete, valid Runway
// database at the current schema with its origin recorded. Returns its row
// counts and schema version.
function verifySnapshot(
  path: string,
  origin: { exportedBy: string; exportedAt: string },
): { rowCounts: Record<string, number>; schemaVersion: number } {
  let copy: DatabaseSync | undefined;
  try {
    copy = new DatabaseSync(path, { readOnly: true });
    const integrity = pragmaValue(copy, 'integrity_check');
    if (integrity !== 'ok') {
      throw new RunwaySnapshotError('verification-failed', `Snapshot failed integrity_check: ${String(integrity)}`);
    }
    if (pragmaValue(copy, 'application_id') !== RUNWAY_APPLICATION_ID) {
      throw new RunwaySnapshotError('verification-failed', 'Snapshot is not a Vermilian Runway database');
    }
    const schemaVersion = Number(pragmaValue(copy, 'user_version'));
    if (schemaVersion !== RUNWAY_SCHEMA_VERSION) {
      throw new RunwaySnapshotError('verification-failed', `Snapshot has unexpected schema version ${schemaVersion}`);
    }
    const recorded = readSnapshotOrigin(copy);
    if (recorded.exportedBy !== origin.exportedBy || recorded.exportedAt !== origin.exportedAt) {
      throw new RunwaySnapshotError('verification-failed', 'Snapshot does not record its origin');
    }
    return { rowCounts: runwayRowCounts(copy), schemaVersion };
  } catch (err) {
    if (err instanceof RunwaySnapshotError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new RunwaySnapshotError('verification-failed', `Snapshot could not be verified: ${message}`);
  } finally {
    copy?.close();
  }
}

// Error codes meaning the filesystem cannot create a hard link there at all.
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK']);

/** Filesystem operations the publish step uses; replaceable in tests. */
export interface SnapshotFs {
  /** Creates `dest` as a hard link to `tmp`; must fail with EEXIST if `dest` exists. */
  link(tmp: string, dest: string): void;
}

const nodeFs: SnapshotFs = { link: linkSync };

// Publishes the verified `tmp` as `dest` with one hard link: atomic (the file
// appears complete or not at all) and no-overwrite (EEXIST if anything,
// including a dangling symbolic link, is already there). Never touches `dest`
// on failure: if the link failed, `dest` is not ours.
function publishExclusive(fs: SnapshotFs, tmp: string, dest: string): void {
  try {
    fs.link(tmp, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST') {
      throw new RunwaySnapshotError('destination-exists', `A file already exists at ${dest}; choose a new name`);
    }
    if (LINK_UNSUPPORTED.has(code)) {
      throw new RunwaySnapshotError(
        'publication-unsupported',
        `No snapshot was created: the folder ${dirname(dest)} does not support safe publishing ` +
          `(hard links, ${code}), which can happen on FAT/exFAT drives and some network shares. ` +
          'Choose a folder on a local disk.',
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new RunwaySnapshotError('export-failed', `Could not write the snapshot to ${dest}: ${message}`);
  }
}

// A temporary name beside the destination that does not exist yet, so the
// cleanup can never remove a file the export did not create.
function temporaryPath(destination: string): string {
  for (;;) {
    const candidate = join(
      dirname(destination),
      `.${basename(destination)}.partial-${randomBytes(8).toString('hex')}`,
    );
    if (!['', '-journal', '-wal', '-shm'].some((suffix) => existsSync(candidate + suffix))) return candidate;
  }
}

/** The suggested file name for a snapshot taken at `now`. */
export function defaultSnapshotFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `vermilian-runway-${stamp}.sqlite`;
}

/**
 * Exports a consistent snapshot of the open Runway database `source` to
 * `destination`, which must be an absolute path that does not exist yet.
 * Resolves with what was written; rejects with a RunwaySnapshotError and
 * leaves no file behind when anything fails.
 */
export interface ExportRunwaySnapshotOptions {
  now?: () => Date;
  fs?: SnapshotFs;
  /** The computer name recorded in the snapshot (default: this host's name). */
  computerName?: string;
}

export async function exportRunwaySnapshot(
  source: DatabaseSync,
  destination: string,
  { now = () => new Date(), fs = nodeFs, computerName = localComputerName() }: ExportRunwaySnapshotOptions = {},
): Promise<RunwaySnapshotSummary> {
  if (typeof destination !== 'string' || !isAbsolute(destination) || basename(destination) === '') {
    throw new RunwaySnapshotError('invalid-destination', 'Choose a file to export the Runway snapshot to');
  }
  if (existsSync(destination) || isDanglingLink(destination)) {
    throw new RunwaySnapshotError('destination-exists', `A file already exists at ${destination}; choose a new name`);
  }

  const tmp = temporaryPath(destination);
  try {
    let pages: number;
    try {
      pages = await backup(source, tmp, { rate: BACKUP_PAGES_PER_STEP });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RunwaySnapshotError('export-failed', `Runway snapshot backup failed: ${message}`);
    }
    const origin = { exportedBy: computerName, exportedAt: now().toISOString() };
    try {
      stampOrigin(tmp, origin.exportedBy, origin.exportedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RunwaySnapshotError('export-failed', `Could not record the snapshot's origin: ${message}`);
    }
    const { rowCounts, schemaVersion } = verifySnapshot(tmp, origin);
    publishExclusive(fs, tmp, destination);
    return { path: destination, ...origin, schemaVersion, rowCounts, pages };
  } finally {
    removeDatabaseFiles(tmp);
  }
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Runway metadata snapshot export (VERM-50, ADR-0011 §6).
//
// Writes the WHOLE Runway metadata database — every workspace, every table —
// to a file the user chose, as an ordinary SQLite database with the same
// schema, application_id and user_version as the live one. That is the format
// the snapshot import (VERM-51) checks and restores, and it doubles as the
// interim manual backup of Jira Runway metadata.
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
//   - Publishing never overwrites: the destination is refused if it exists,
//     and the final step is a hard link (or an exclusive copy where the
//     filesystem has no hard links), both of which fail rather than replace a
//     file that appeared in the meantime.
//   - On any failure the temporary file and its SQLite side files are removed,
//     so a failed export never leaves something that looks like a valid backup.
//
// No Electron import, so it runs under vitest; the IPC handler owns the dialog.

import { randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { RUNWAY_APPLICATION_ID, RUNWAY_SCHEMA_VERSION } from './runwayDb';

/** The tables a schema v1 snapshot must contain, with their row counts reported. */
export const RUNWAY_SNAPSHOT_TABLES = ['runway_entry', 'dismissal'] as const;

/** Pages copied per backup step; the lock is released between steps. */
const BACKUP_PAGES_PER_STEP = 64;

export type RunwaySnapshotErrorCode =
  | 'invalid-destination' // not an absolute path to a file
  | 'destination-exists' // never overwritten
  | 'verification-failed' // the copy did not check out; nothing was published
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
  /** ISO 8601 time the export finished. */
  exportedAt: string;
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

/** Row counts for every snapshot table, from an open database. */
export function runwayRowCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of RUNWAY_SNAPSHOT_TABLES) {
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

// Opens the copy read-only and checks that it is a complete, valid Runway
// database. Returns its row counts and schema version.
function verifySnapshot(path: string): { rowCounts: Record<string, number>; schemaVersion: number } {
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
    if (schemaVersion < 1 || schemaVersion > RUNWAY_SCHEMA_VERSION) {
      throw new RunwaySnapshotError('verification-failed', `Snapshot has unexpected schema version ${schemaVersion}`);
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

// Publishes `tmp` as `dest` without ever replacing an existing file. A hard
// link is atomic and fails with EEXIST; where the filesystem has no hard links
// (FAT/exFAT volumes, some network shares) an exclusive copy is used instead,
// and a half-written destination is removed if that copy fails.
function publishExclusive(tmp: string, dest: string): void {
  try {
    linkSync(tmp, dest);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new RunwaySnapshotError('destination-exists', `A file already exists at ${dest}; choose a new name`);
    }
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'EXDEV' && code !== 'ENOSYS') {
      throw err;
    }
  }
  try {
    copyFileSync(tmp, dest, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new RunwaySnapshotError('destination-exists', `A file already exists at ${dest}; choose a new name`);
    }
    // COPYFILE_EXCL created the file, so a partial copy is ours to remove.
    rmSync(dest, { force: true });
    throw err;
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
export async function exportRunwaySnapshot(
  source: DatabaseSync,
  destination: string,
  now: () => Date = () => new Date(),
): Promise<RunwaySnapshotSummary> {
  if (typeof destination !== 'string' || !isAbsolute(destination) || basename(destination) === '') {
    throw new RunwaySnapshotError('invalid-destination', 'Choose a file to export the Runway snapshot to');
  }
  if (existsSync(destination) || isDanglingLink(destination)) {
    throw new RunwaySnapshotError('destination-exists', `A file already exists at ${destination}; choose a new name`);
  }

  const tmp = join(
    dirname(destination),
    `.${basename(destination)}.partial-${randomBytes(6).toString('hex')}`,
  );
  try {
    let pages: number;
    try {
      pages = await backup(source, tmp, { rate: BACKUP_PAGES_PER_STEP });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RunwaySnapshotError('export-failed', `Runway snapshot backup failed: ${message}`);
    }
    const { rowCounts, schemaVersion } = verifySnapshot(tmp);
    try {
      publishExclusive(tmp, destination);
    } catch (err) {
      if (err instanceof RunwaySnapshotError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new RunwaySnapshotError('export-failed', `Could not write the snapshot to ${destination}: ${message}`);
    }
    return { path: destination, exportedAt: now().toISOString(), schemaVersion, rowCounts, pages };
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

import fs from 'fs';
import os from 'os';
import path from 'path';

// Electron profile directories for the e2e suite (VERM-54).
//
// Every launch needs its own --user-data-dir, and each one is a Chromium
// profile of ~85 files. Created loose in os.tmpdir() and never removed, a full
// run left ~250 of them behind; 9,614 had accumulated on the FLDW by
// 2026-11-15 and exhausted the /tmp tmpfs's inodes for the whole host.
//
// So every profile of a run now lives inside one run root,
// <tmpdir>/vermilian-e2e-run-XXXXXX/. global-setup.ts creates it and removes it
// when the run ends; a run that was killed leaves just that one directory,
// which the next run's setup sweeps once it is older than STALE_MS.

/** Path of the current run's root, set by global-setup.ts for the workers. */
export const RUN_ROOT_ENV = 'VERMILIAN_E2E_PROFILE_ROOT';
/** Set to 1 to keep this run's profiles for debugging (swept by a later run). */
export const KEEP_ENV = 'VERMILIAN_E2E_KEEP_PROFILES';

const RUN_ROOT_PREFIX = 'vermilian-e2e-run-';
// Matches the run roots and the loose vermilian-e2e-* profiles that runs
// before VERM-54 left behind.
const SWEEP_PREFIX = 'vermilian-e2e-';
// Far longer than any single test (30 s) or full run, so a directory this
// old is never one a concurrent run is still using. A run root's mtime moves
// every time a profile is created inside it.
const STALE_MS = 60 * 60 * 1000;

export function keepProfiles(): boolean {
  return process.env[KEEP_ENV] === '1';
}

export function createRunRoot(tmp = os.tmpdir()): string {
  return fs.mkdtempSync(path.join(tmp, RUN_ROOT_PREFIX));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Removes vermilian-e2e-* directories in `tmp` not modified for STALE_MS.
 * Returns the paths removed. Directories owned by another user are skipped.
 */
export function sweepStale(tmp = os.tmpdir(), now = Date.now()): string[] {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(SWEEP_PREFIX)) continue;
    const dir = path.join(tmp, name);
    try {
      const st = fs.lstatSync(dir);
      if (!st.isDirectory()) continue;
      if (uid !== undefined && st.uid !== uid) continue;
      if (now - st.mtimeMs < STALE_MS) continue;
      removeDir(dir);
      removed.push(dir);
    } catch {
      // Raced with another sweeper, or not removable: leave it.
    }
  }
  return removed;
}

// Fallback for a worker started without global-setup.ts (e.g. a config that
// does not register it): a per-worker root, removed when the worker exits.
let workerRoot: string | undefined;

function runRoot(): string {
  const fromSetup = process.env[RUN_ROOT_ENV];
  if (fromSetup && fs.existsSync(fromSetup)) return fromSetup;
  if (!workerRoot) {
    const root = createRunRoot();
    workerRoot = root;
    process.on('exit', () => {
      if (!keepProfiles()) {
        try { removeDir(root); } catch { /* best effort at exit */ }
      }
    });
  }
  return workerRoot;
}

/** A new, empty profile directory inside this run's root. */
export function newProfileDir(): string {
  return fs.mkdtempSync(path.join(runRoot(), 'profile-'));
}

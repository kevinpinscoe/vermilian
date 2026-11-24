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
//
// VERM-112: global-setup.ts also points TMPDIR (and TMP/TEMP) at the run root,
// so every os.tmpdir() call in a worker, and Chromium's own temp files in the
// Electron processes the workers launch, land inside it and go with it. The
// temp directory as it was before that is kept in ORIGINAL_TMP_ENV; the
// leftover check after the run looks there.

/** Path of the current run's root, set by global-setup.ts for the workers. */
export const RUN_ROOT_ENV = 'VERMILIAN_E2E_PROFILE_ROOT';
/** Set to 1 to keep this run's profiles for debugging (swept by a later run). */
export const KEEP_ENV = 'VERMILIAN_E2E_KEEP_PROFILES';

/** The temp directory before global-setup.ts pointed TMPDIR at the run root. */
export const ORIGINAL_TMP_ENV = 'VERMILIAN_E2E_ORIGINAL_TMPDIR';
/** Set to a directory to write the PR evidence screenshots there and keep them. */
export const EVIDENCE_ENV = 'VERMILIAN_E2E_EVIDENCE_DIR';
/** The variables os.tmpdir() and Chromium read the temp directory from. */
export const TMP_VARS = ['TMPDIR', 'TMP', 'TEMP'] as const;

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

/** The temp directory outside the run root: where loose folders would leak to. */
export function sharedTmpDir(): string {
  return process.env[ORIGINAL_TMP_ENV] || os.tmpdir();
}

/** Points every temp-directory variable at `root`. Returns the previous temp directory. */
export function redirectTmp(root: string): string {
  const original = os.tmpdir();
  process.env[ORIGINAL_TMP_ENV] = original;
  for (const name of TMP_VARS) process.env[name] = root;
  return original;
}

// Folder names the e2e specs have used for temp directories. Inside a run
// root they go with it; one of these in the shared temp directory means a
// spec escaped the redirect, or another run left it there.
const E2E_NAME = /^(vermilian-e2e-|vermilian-live-profile-|verm-e2e-|verm\d+-e2e-)/;

/** Names of e2e folders in `tmp` owned by this user. */
export function listE2eFolders(tmp: string): string[] {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  let names: string[];
  try {
    names = fs.readdirSync(tmp);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      if (!E2E_NAME.test(name)) return false;
      try {
        const st = fs.lstatSync(path.join(tmp, name));
        return st.isDirectory() && (uid === undefined || st.uid === uid);
      } catch {
        return false;
      }
    })
    .sort();
}

export interface RunEnd {
  root: string;
  tmp: string;
  /** listE2eFolders(tmp) taken when the run started. */
  before: readonly string[];
  keep: boolean;
  evidenceDir?: string;
  remove?: (dir: string) => void;
}

export interface RunEndReport {
  /** False when this run's own root could not be removed. */
  ok: boolean;
  lines: string[];
}

/**
 * The end-of-run cleanup and leftover check. Removes the run root unless it
 * is being kept, fails if it is still there afterwards, and warns about e2e
 * folders that appeared in the shared temp directory during the run. Those
 * are left alone: another lane's run may own them.
 */
export function endRun(run: RunEnd): RunEndReport {
  const lines: string[] = [];
  let ok = true;
  if (run.keep) {
    lines.push(`[e2e] kept this run's temp files in ${run.root} (${KEEP_ENV}=1)`);
    const kept = run.evidenceDir ? [path.resolve(run.evidenceDir)] : evidenceFolders(run.root);
    for (const dir of kept) lines.push(`[e2e] screenshot evidence: ${dir}`);
  } else {
    try {
      (run.remove ?? removeDir)(run.root);
    } catch {
      // Reported below.
    }
    if (fs.existsSync(run.root)) {
      ok = false;
      lines.push(`[e2e] cleanup check failed: could not remove this run's root ${run.root}`);
    }
    if (run.evidenceDir) lines.push(`[e2e] screenshot evidence: ${path.resolve(run.evidenceDir)}`);
  }
  const before = new Set(run.before);
  const added = listE2eFolders(run.tmp).filter((name) => !before.has(name));
  if (added.length > 0) {
    lines.push(
      `[e2e] warning: ${added.length} e2e folder(s) appeared in ${run.tmp} during this run, outside its root. ` +
        'Left in place, since another run may own them:',
    );
    for (const name of added) lines.push(`[e2e]   ${path.join(run.tmp, name)}`);
  }
  return { ok, lines };
}

function evidenceFolders(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .filter((name) => name.startsWith('evidence-'))
      .sort()
      .map((name) => path.join(root, name));
  } catch {
    return [];
  }
}

/** The environment variables a run's setup changes, all restored by its teardown. */
export const RUN_ENV_VARS = [RUN_ROOT_ENV, ORIGINAL_TMP_ENV, ...TMP_VARS] as const;

/**
 * Captures `names` as they are now and returns a function that puts them
 * back, deleting any that were unset rather than leaving them as "" or the
 * changed value.
 */
export function snapshotEnv(names: readonly string[]): () => void {
  const saved = names.map((name) => [name, Object.prototype.hasOwnProperty.call(process.env, name), process.env[name]] as const);
  return () => {
    for (const [name, wasSet, value] of saved) {
      if (wasSet) process.env[name] = value;
      else delete process.env[name];
    }
  };
}

export interface StartRunOptions {
  keep?: () => boolean;
  remove?: (dir: string) => void;
  log?: (line: string) => void;
}

/**
 * The body of global-setup.ts: sweeps stale roots, creates this run's root,
 * points the temp-directory variables at it, and returns the teardown. The
 * teardown runs the end-of-run check and then, in a finally block, restores
 * every variable in RUN_ENV_VARS to what it was before setup, whether the
 * root was removed, kept, or could not be removed. So a second run in the
 * same process starts from the real temp directory, not the first run's
 * (deleted) root.
 */
export function startRun(opts: StartRunOptions = {}): () => void {
  const log = opts.log ?? ((line: string) => console.log(line));
  const restoreEnv = snapshotEnv(RUN_ENV_VARS);
  try {
    for (const dir of sweepStale()) log(`[e2e] removed stale profile directory ${dir}`);
    const root = createRunRoot();
    process.env[RUN_ROOT_ENV] = root;
    const tmp = redirectTmp(root);
    const before = listE2eFolders(tmp);
    return () => {
      try {
        const report = endRun({
          root,
          tmp,
          before,
          keep: (opts.keep ?? keepProfiles)(),
          evidenceDir: process.env[EVIDENCE_ENV],
          remove: opts.remove,
        });
        for (const line of report.lines) log(line);
        if (!report.ok) throw new Error(`e2e cleanup check failed: ${root} is still present`);
      } finally {
        restoreEnv();
      }
    };
  } catch (err) {
    restoreEnv();
    throw err;
  }
}

// One evidence folder per worker: VERMILIAN_E2E_EVIDENCE_DIR when set, else
// evidence-w<N> in the run root, which goes with the root unless the run is
// kept.
let workerEvidence: string | undefined;

export function evidenceDir(): string {
  if (!workerEvidence) {
    const dir =
      process.env[EVIDENCE_ENV] ||
      path.join(runRoot(), `evidence-w${process.env.TEST_PARALLEL_INDEX ?? process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    workerEvidence = dir;
  }
  return workerEvidence;
}

/**
 * A path for a screenshot named `file` that no earlier capture has: the name
 * itself the first time, then name-2, name-3 ... The file is reserved with an
 * exclusive create, so repeats, retries, parallel workers and earlier runs
 * writing to the same VERMILIAN_E2E_EVIDENCE_DIR never overwrite each other.
 */
export function evidencePath(file: string, dir = evidenceDir()): string {
  const ext = path.extname(file);
  const stem = file.slice(0, file.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? file : `${stem}-${n}${ext}`);
    try {
      fs.closeSync(fs.openSync(candidate, 'wx'));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

// Main-process import lifecycle (VERM-51 correction): the IPC handlers in
// ipc.ts delegate every preview/confirm/cancel to RunwayImportSession, so
// these tests drive the same code with a real live database, real staging
// and the real import, held open at controlled points.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRunwayDb } from './runwayDb';
import {
  RunwayImportError,
  RunwayWriteGate,
  clearRunwayImportStaging,
  importRunwaySnapshot,
  inspectRunwaySnapshot,
  runwayFingerprint,
  type RunwayImportHooks,
  type StagedRunwaySnapshot,
} from './runwayImport';
import { RunwayImportSession } from './runwayImportSession';
import { exportRunwaySnapshot, runwayRowCounts } from './runwaySnapshot';

let dir: string;
let outDir: string;
let live: DatabaseSync;
let staging: string;
let backups: string;
let session: RunwayImportSession;
const gate = new RunwayWriteGate();
const NOW = '2026-01-05T09:00:00.000Z';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vermilian-session-test-'));
  outDir = mkdtempSync(join(tmpdir(), 'vermilian-session-out-'));
  live = openRunwayDb(join(dir, 'runway-metadata.sqlite'));
  staging = join(dir, 'runway-import-staging');
  backups = join(dir, 'runway-backups');
  session = new RunwayImportSession({ stagingDir: staging });
  live.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
     VALUES ('ws-a', 'jira:LIVE-1', 1, 1, 'live only', 0, ?)`,
  ).run(NOW);
});

afterEach(() => {
  live.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

async function makeSnapshot(name: string, issue = 'jira:DEMO-1'): Promise<string> {
  const otherDir = mkdtempSync(join(tmpdir(), 'vermilian-session-other-'));
  const other = openRunwayDb(join(otherDir, 'runway-metadata.sqlite'));
  try {
    other.prepare(
      `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, deferred, updated_at)
       VALUES ('ws-a', ?, 1, 1, 'from snapshot', 0, ?), ('ws-b', ?, 1, 2, null, 0, ?)`,
    ).run(issue, NOW, issue, NOW);
    const dest = join(outDir, name);
    await exportRunwaySnapshot(other, dest);
    return dest;
  } finally {
    other.close();
    rmSync(otherDir, { recursive: true, force: true });
  }
}

/** A promise plus its resolver, to hold an import at a chosen point. */
function latch(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  return { promise, release };
}

// What the confirm IPC handler runs: the import, through the write gate.
function runImport(hooks: RunwayImportHooks = {}) {
  return (staged: StagedRunwaySnapshot) =>
    gate.run(() => importRunwaySnapshot(live, staged, { backupDir: backups, hooks }));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(RunwayImportError);
    return (err as RunwayImportError).code;
  }
  throw new Error('expected a RunwayImportError');
}

const ticks = () => new Promise((r) => setTimeout(r, 10));

describe('RunwayImportSession — the original race', () => {
  it('reproduction: the old unconditional staging cleanup deletes an active import\'s staged copy', async () => {
    // This is what a second preview did before the fix: clear the staging
    // directory with no regard for a running import.
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    expect(existsSync(staged!.stagedPath)).toBe(true);
    clearRunwayImportStaging(staging); // pre-fix behaviour
    expect(existsSync(staged!.stagedPath)).toBe(false);
    // With the active import's file excluded (the fix), it survives.
    const again = await session.preview(async () => makeSnapshot('b.sqlite'));
    clearRunwayImportStaging(staging, [basename(again!.stagedPath)]);
    expect(existsSync(again!.stagedPath)).toBe(true);
  });

  it('refuses a second preview while a confirmed import is held, keeps its staged copy, and cleans up after success', async () => {
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    const hold = latch();
    const reached = latch();
    const importing = session.confirm(staged!.token, runImport({
      afterBackup: async () => { reached.release(); await hold.promise; },
    }));
    await reached.promise; // held after confirmation, before the replacement

    expect(session.importing).toBe(true);
    // A second preview from another window/IPC caller is refused in the main
    // process, before its dialog is even shown.
    let dialogShown = false;
    expect(await codeOf(session.preview(async () => { dialogShown = true; return makeSnapshot('b.sqlite'); })))
      .toBe('import-in-progress');
    expect(dialogShown).toBe(false);
    // A crash-recovery style cleanup during the import skips its files.
    session.clearStaging();
    // The active staged copy still exists and is still valid.
    expect(existsSync(staged!.stagedPath)).toBe(true);
    expect(inspectRunwaySnapshot(staged!.stagedPath).fingerprint).toBe(staged!.fingerprint);

    hold.release();
    const result = await importing;
    expect(result.rowCounts).toEqual({ runway_entry: 2, dismissal: 0, runway_item: 0 });
    expect(runwayFingerprint(live)).toBe(staged!.fingerprint);
    // Staging is cleaned up only now that the import has finished.
    expect(session.importing).toBe(false);
    expect(readdirSync(staging)).toEqual([]);
    // And previews work again.
    expect(await session.preview(async () => makeSnapshot('c.sqlite'))).not.toBeNull();
  });

  it('refuses an import confirmed from another window while a preview dialog was open', async () => {
    const first = await session.preview(async () => makeSnapshot('a.sqlite'));
    const hold = latch();
    const reached = latch();
    // Window 2 opens a preview dialog and leaves it open...
    const dialog = latch();
    const secondPreview = session.preview(async () => { await dialog.promise; return makeSnapshot('b.sqlite'); });
    // ...window 1 confirms its pending import, which is now active and held.
    const importing = session.confirm(first!.token, runImport({
      afterBackup: async () => { reached.release(); await hold.promise; },
    }));
    await reached.promise;
    // Window 2's dialog closes with a file chosen: refused, nothing removed.
    dialog.release();
    expect(await codeOf(secondPreview)).toBe('import-in-progress');
    expect(existsSync(first!.stagedPath)).toBe(true);
    hold.release();
    await importing;
    expect(readdirSync(staging)).toEqual([]);
  });

  it('refuses a second preview dialog while one is already open', async () => {
    const dialog = latch();
    const firstPreview = session.preview(async () => { await dialog.promise; return null; });
    expect(await codeOf(session.preview(async () => makeSnapshot('b.sqlite')))).toBe('import-in-progress');
    dialog.release();
    expect(await firstPreview).toBeNull();
  });
});

describe('RunwayImportSession — duplicate confirmation and cancellation', () => {
  it('refuses duplicate and overlapping confirmations, and a cancel does not interrupt the active import', async () => {
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    const hold = latch();
    const reached = latch();
    let runs = 0;
    const importing = session.confirm(staged!.token, (s) => {
      runs++;
      return runImport({ afterBackup: async () => { reached.release(); await hold.promise; } })(s);
    });
    await reached.promise;

    // The same token again (double click, second window): refused.
    expect(await codeOf(session.confirm(staged!.token, async () => { runs++; }))).toBe('import-in-progress');
    // Any other token: refused too.
    expect(await codeOf(session.confirm('another-token', async () => { runs++; }))).toBe('import-in-progress');
    // Cancelling with the active token does nothing to the running import.
    session.cancel(staged!.token);
    expect(existsSync(staged!.stagedPath)).toBe(true);
    expect(session.importing).toBe(true);

    hold.release();
    await importing;
    expect(runs).toBe(1);
    expect(runwayFingerprint(live)).toBe(staged!.fingerprint);
    // The token is spent: confirming it after completion is refused.
    expect(await codeOf(session.confirm(staged!.token, async () => undefined))).toBe('no-preview');
  });

  it('two confirmations sent in the same tick: exactly one import runs', async () => {
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    const outcomes = await Promise.allSettled([
      session.confirm(staged!.token, runImport()),
      session.confirm(staged!.token, runImport()),
    ]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as RunwayImportError).code).toBe('import-in-progress');
    expect(readdirSync(backups)).toHaveLength(1);
  });

  it('a cancel of a pending (not yet confirmed) preview discards it', async () => {
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    session.cancel(staged!.token);
    expect(existsSync(staged!.stagedPath)).toBe(false);
    expect(await codeOf(session.confirm(staged!.token, async () => undefined))).toBe('no-preview');
  });
});

describe('RunwayImportSession — failure while active', () => {
  it('refuses previews during a held failing import, then cleans up, rolls back and keeps the backup', async () => {
    const before = runwayFingerprint(live);
    const staged = await session.preview(async () => makeSnapshot('a.sqlite'));
    const hold = latch();
    const reached = latch();
    const importing = session.confirm(staged!.token, runImport({
      afterBackup: async () => { reached.release(); await hold.promise; },
      afterDelete: () => { throw new Error('power cut mid-replace'); },
    }));
    await reached.promise;
    expect(await codeOf(session.preview(async () => makeSnapshot('b.sqlite')))).toBe('import-in-progress');
    expect(existsSync(staged!.stagedPath)).toBe(true);

    hold.release();
    const err = (await importing.catch((e) => e)) as RunwayImportError;
    expect(err.code).toBe('import-failed');
    // Rolled back: live data unchanged.
    expect(runwayFingerprint(live)).toBe(before);
    expect(runwayRowCounts(live)).toEqual({ runway_entry: 1, dismissal: 0, runway_item: 0 });
    // The recovery backup is preserved and holds the pre-import state.
    expect(err.backupPath && existsSync(err.backupPath)).toBe(true);
    const backup = new DatabaseSync(err.backupPath!, { readOnly: true });
    try {
      expect(runwayFingerprint(backup)).toBe(before);
    } finally {
      backup.close();
    }
    // Staging cleaned up after the failure; the session accepts new work.
    expect(session.importing).toBe(false);
    expect(readdirSync(staging)).toEqual([]);
    const next = await session.preview(async () => makeSnapshot('c.sqlite'));
    expect(next).not.toBeNull();
    // Recovery: the next import works normally.
    await session.confirm(next!.token, runImport());
    expect(runwayFingerprint(live)).toBe(next!.fingerprint);
  });

  it('cleans up when the import fails before the backup (e.g. snapshot changed)', async () => {
    const src = await makeSnapshot('a.sqlite');
    const staged = await session.preview(async () => src);
    rmSync(src);
    expect(await codeOf(session.confirm(staged!.token, runImport()))).toBe('snapshot-changed');
    expect(session.importing).toBe(false);
    expect(readdirSync(staging)).toEqual([]);
    await ticks();
  });
});

describe('RunwayImportSession — previews', () => {
  it('a new preview replaces the pending one and removes only its staged copy', async () => {
    const first = await session.preview(async () => makeSnapshot('a.sqlite'));
    const second = await session.preview(async () => makeSnapshot('b.sqlite', 'jira:DEMO-2'));
    expect(existsSync(first!.stagedPath)).toBe(false);
    expect(existsSync(second!.stagedPath)).toBe(true);
    expect(await codeOf(session.confirm(first!.token, async () => undefined))).toBe('no-preview');
  });

  it('a cancelled dialog changes nothing', async () => {
    const pending = await session.preview(async () => makeSnapshot('a.sqlite'));
    expect(await session.preview(async () => null)).toBeNull();
    expect(existsSync(pending!.stagedPath)).toBe(true);
  });

  it('shutdown drops the pending preview', async () => {
    const pending = await session.preview(async () => makeSnapshot('a.sqlite'));
    session.shutdown();
    expect(existsSync(pending!.stagedPath)).toBe(false);
  });
});

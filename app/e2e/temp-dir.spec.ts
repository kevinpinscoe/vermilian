/**
 * The e2e temp-directory contract (VERM-112).
 *
 * global-setup.ts points TMPDIR/TMP/TEMP at the run's root so every temp
 * folder a spec or Chromium creates is removed with it. These tests check
 * that a worker and the Electron process it launches both see that root, and
 * cover the end-of-run check and the evidence paths directly.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import {
  endRun,
  evidenceDir,
  evidencePath,
  listE2eFolders,
  ORIGINAL_TMP_ENV,
  RUN_ENV_VARS,
  RUN_ROOT_ENV,
  snapshotEnv,
  startRun,
} from './helpers/profiles';

function inside(child: string, parent: string): boolean {
  const rel = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// A scratch "shared temp directory" for the endRun tests, itself inside the
// run root so it goes with it.
function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'endrun-'));
}

test.describe('e2e temp directory', () => {
  test('a worker uses the run root as its temp directory', () => {
    const root = process.env[RUN_ROOT_ENV];
    expect(root, `${RUN_ROOT_ENV} is set by global-setup.ts`).toBeTruthy();
    expect(path.basename(root!)).toMatch(/^vermilian-e2e-run-/);
    expect(os.tmpdir()).toBe(root);
    expect(process.env[ORIGINAL_TMP_ENV]).toBeTruthy();
    expect(process.env[ORIGINAL_TMP_ENV]).not.toBe(root);
    expect(inside(evidenceDir(), root!)).toBe(!process.env.VERMILIAN_E2E_EVIDENCE_DIR);
  });

  test('the Electron process it launches uses the run root too', async () => {
    const root = process.env[RUN_ROOT_ENV]!;
    const userDataDir = freshUserDataDir();
    const app = await launchAppWithUserDataDir(userDataDir);
    try {
      const seen = await app.evaluate(({ app: electronApp }) => ({
        tmpdir: process.env.TMPDIR,
        tmp: process.env.TMP,
        temp: process.env.TEMP,
        chromiumTemp: electronApp.getPath('temp'),
      }));
      expect(seen.tmpdir).toBe(root);
      expect(seen.tmp).toBe(root);
      expect(seen.temp).toBe(root);
      expect(inside(seen.chromiumTemp, root), `Chromium temp ${seen.chromiumTemp}`).toBe(true);
    } finally {
      await app.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('evidence paths never overwrite an earlier capture', () => {
    const dir = scratch();
    const first = evidencePath('shot.png', dir);
    const second = evidencePath('shot.png', dir);
    const third = evidencePath('shot.png', dir);
    expect([first, second, third].map((p) => path.basename(p))).toEqual(['shot.png', 'shot-2.png', 'shot-3.png']);
    expect(path.basename(evidencePath('other.png', dir))).toBe('other.png');
  });

  test('endRun removes the root and passes when nothing leaked', () => {
    const tmp = scratch();
    const root = fs.mkdtempSync(path.join(tmp, 'vermilian-e2e-run-'));
    const before = listE2eFolders(tmp).filter((name) => name !== path.basename(root));
    const report = endRun({ root, tmp, before: [...before, path.basename(root)], keep: false });
    expect(report).toEqual({ ok: true, lines: [] });
    expect(fs.existsSync(root)).toBe(false);
  });

  test('endRun fails and names the root when it cannot be removed', () => {
    const tmp = scratch();
    const root = fs.mkdtempSync(path.join(tmp, 'vermilian-e2e-run-'));
    const report = endRun({
      root,
      tmp,
      before: [path.basename(root)],
      keep: false,
      remove: () => {
        throw new Error('EBUSY');
      },
    });
    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain(`could not remove this run's root ${root}`);
  });

  test('endRun keeps the root with KEEP_PROFILES and says where the evidence is', () => {
    const tmp = scratch();
    const root = fs.mkdtempSync(path.join(tmp, 'vermilian-e2e-run-'));
    fs.mkdirSync(path.join(root, 'evidence-w0'));
    const report = endRun({ root, tmp, before: [path.basename(root)], keep: true });
    expect(report.ok).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
    expect(report.lines).toContain(`[e2e] screenshot evidence: ${path.join(root, 'evidence-w0')}`);
  });

  test('endRun warns about, and leaves, new e2e folders in the shared directory', () => {
    const tmp = scratch();
    const old = path.join(tmp, 'verm-e2e-jira-old');
    fs.mkdirSync(old);
    const root = fs.mkdtempSync(path.join(tmp, 'vermilian-e2e-run-'));
    const before = listE2eFolders(tmp);
    const leaked = path.join(tmp, 'vermilian-e2e-evidence-leak');
    fs.mkdirSync(leaked);
    fs.mkdirSync(path.join(tmp, 'unrelated-folder'));
    const report = endRun({ root, tmp, before, keep: false });
    expect(report.ok).toBe(true);
    expect(report.lines[0]).toMatch(/^\[e2e\] warning: 1 e2e folder\(s\) appeared in /);
    expect(report.lines).toContain(`[e2e]   ${leaked}`);
    expect(report.lines.join('\n')).not.toContain(old);
    expect(fs.existsSync(leaked)).toBe(true);
  });

  // setup/teardown in this worker, as if it were a fresh Playwright process
  // whose temp directory is `original`, with TMP, TEMP and both e2e
  // variables unset. The worker's own environment is put back afterwards.
  function asFreshProcess(fn: (original: string) => void): void {
    const original = scratch();
    const restoreWorker = snapshotEnv(RUN_ENV_VARS);
    try {
      for (const name of RUN_ENV_VARS) delete process.env[name];
      process.env.TMPDIR = original;
      fn(original);
    } finally {
      restoreWorker();
    }
  }

  function expectEnvRestored(original: string): void {
    expect(process.env.TMPDIR).toBe(original);
    for (const name of RUN_ENV_VARS.filter((n) => n !== 'TMPDIR')) {
      expect(Object.prototype.hasOwnProperty.call(process.env, name), `${name} stays unset`).toBe(false);
    }
    expect(os.tmpdir()).toBe(original);
  }

  const quiet = { log: () => {} };

  test('setup then teardown twice in one process: the second root is under the original temp directory', () => {
    asFreshProcess((original) => {
      const roots: string[] = [];
      for (let run = 0; run < 2; run++) {
        const teardown = startRun({ ...quiet, keep: () => false });
        const root = process.env[RUN_ROOT_ENV]!;
        roots.push(root);
        expect(path.dirname(root)).toBe(original);
        expect(os.tmpdir()).toBe(root);
        expect(process.env[ORIGINAL_TMP_ENV]).toBe(original);
        teardown();
        expect(fs.existsSync(root)).toBe(false);
        expectEnvRestored(original);
      }
      expect(roots[1]).not.toBe(roots[0]);
    });
  });

  test('teardown restores the environment in keep mode', () => {
    asFreshProcess((original) => {
      const teardown = startRun({ ...quiet, keep: () => true });
      const root = process.env[RUN_ROOT_ENV]!;
      teardown();
      expect(fs.existsSync(root)).toBe(true);
      expectEnvRestored(original);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  test('teardown restores the environment when the cleanup check fails', () => {
    asFreshProcess((original) => {
      const teardown = startRun({ ...quiet, keep: () => false, remove: () => {} });
      const root = process.env[RUN_ROOT_ENV]!;
      expect(() => teardown()).toThrow(`e2e cleanup check failed: ${root} is still present`);
      expectEnvRestored(original);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  test('teardown restores variables that were set to their original values', () => {
    asFreshProcess((original) => {
      process.env.TMP = '/original-tmp';
      process.env.TEMP = '';
      const teardown = startRun({ ...quiet, keep: () => false });
      expect(process.env.TMP).toBe(process.env[RUN_ROOT_ENV]);
      teardown();
      expect(process.env.TMPDIR).toBe(original);
      expect(process.env.TMP).toBe('/original-tmp');
      expect(process.env.TEMP).toBe('');
      expect(Object.prototype.hasOwnProperty.call(process.env, RUN_ROOT_ENV)).toBe(false);
    });
  });
});

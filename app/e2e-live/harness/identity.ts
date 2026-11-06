/**
 * Build and environment identity recorded with every run, so a result always
 * says which binary it describes and whether that binary is the pinned human
 * acceptance build or a later development build.
 */

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** The build pinned in docs/priority-desk-acceptance.md → "Acceptance build". */
export const PINNED_ACCEPTANCE_BUILD = {
  sourceCommit: '0348099ddf3b34c0b0c51f076210c6ada3190a18',
  version: '1.2.9',
  asarSha256: '44d4ee7e866a6b2ea7c162001fb9966eb3255e94fce37ddc7d957a4355855055',
};

/** Chromium flags used for every live launch (same as the deterministic suite). */
export const ELECTRON_ARGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-gpu-compositing',
  '--in-process-gpu',
];

export type BuildKind = 'pinned-acceptance' | 'development' | 'unknown';

export interface BuildIdentity {
  kind: BuildKind;
  executable: string;
  executableExists: boolean;
  asarPath: string;
  asarSha256: string | null;
  sourceCommit: string | null;
  sourceCommitBasis: string;
  appVersion: string | null;
}

export interface RunIdentity {
  build: BuildIdentity;
  harnessCommit: string | null;
  harnessDirty: boolean | null;
  os: string;
  kernel: string;
  hostname: string;
  timeZone: string;
  utcOffsetMinutes: number;
  nodeVersion: string;
  launchFlags: string[];
  fakeServiceEnvRemoved: string[];
  startedAt: string;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function asarPathFor(executable: string): string {
  if (process.platform === 'darwin') {
    return path.resolve(path.dirname(executable), '..', 'Resources', 'app.asar');
  }
  return path.join(path.dirname(executable), 'resources', 'app.asar');
}

export function sha256(file: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Source commit for a build. Development builds made with
 * e2e-live/package-dev-build.sh carry a live-build-info.json written at
 * package time; anything else falls back to "unknown" rather than guessing
 * from whatever the checkout happens to be on now.
 */
function sourceCommitFor(executable: string, asarHash: string | null): { commit: string | null; basis: string; version: string | null } {
  if (asarHash === PINNED_ACCEPTANCE_BUILD.asarSha256) {
    return { commit: PINNED_ACCEPTANCE_BUILD.sourceCommit, basis: 'app.asar hash matches the pinned acceptance build', version: PINNED_ACCEPTANCE_BUILD.version };
  }
  const outDir = path.resolve(path.dirname(executable), process.platform === 'darwin' ? '../../..' : '..');
  const infoFile = path.join(outDir, 'live-build-info.json');
  try {
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf-8')) as { sourceCommit: string; dirty: boolean; asarSha256: string; version: string };
    if (info.asarSha256 === asarHash) {
      return { commit: info.sourceCommit + (info.dirty ? ' (uncommitted changes at build time)' : ''), basis: `recorded at package time in ${infoFile}`, version: info.version };
    }
    return { commit: null, basis: `${infoFile} exists but describes a different app.asar — rebuilt since?`, version: null };
  } catch {
    return { commit: null, basis: 'no build record; build with e2e-live/package-dev-build.sh to record one', version: null };
  }
}

export function buildIdentity(executable: string): BuildIdentity {
  const asarPath = asarPathFor(executable);
  const asarSha256 = sha256(asarPath);
  const src = sourceCommitFor(executable, asarSha256);
  const kind: BuildKind = asarSha256 === PINNED_ACCEPTANCE_BUILD.asarSha256
    ? 'pinned-acceptance'
    : asarSha256 ? 'development' : 'unknown';
  return {
    kind,
    executable,
    executableExists: fs.existsSync(executable),
    asarPath,
    asarSha256,
    sourceCommit: src.commit,
    sourceCommitBasis: src.basis,
    appVersion: src.version,
  };
}

function osName(): string {
  try {
    const m = fs.readFileSync('/etc/os-release', 'utf-8').match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
  } catch { /* not Linux */ }
  return `${os.type()} ${os.release()}`;
}

export function runIdentity(executable: string, fakeServiceEnvRemoved: string[] = []): RunIdentity {
  const appDir = path.resolve(__dirname, '../..');
  const status = git(appDir, ['status', '--porcelain']);
  return {
    build: buildIdentity(executable),
    harnessCommit: git(appDir, ['rev-parse', 'HEAD']),
    harnessDirty: status === null ? null : status.length > 0,
    os: osName(),
    kernel: `${os.type()} ${os.release()} ${os.arch()}`,
    hostname: os.hostname(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
    nodeVersion: process.version,
    launchFlags: ELECTRON_ARGS,
    fakeServiceEnvRemoved,
    startedAt: new Date().toISOString(),
  };
}

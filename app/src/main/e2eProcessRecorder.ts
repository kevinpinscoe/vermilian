// e2e only (VERM-106): records every process the main process launches and
// every path or URL it hands to the desktop, so a packaged test can prove that
// Runway, sort and import actions start no agent, send nothing to tmux and
// never invoke ConTower — while a shell-command credential still runs.
//
// Exclusive to the e2e build: __VERMILIAN_E2E_BUILD__ is false in a release
// package (vite.main.config.ts), so the install below and the debug channel
// that reads the record (main/ipc.ts) are compiled out and no flag can turn
// them on. In an e2e build it still installs only when VERMILIAN_E2E=1.
//
// It must be the main entry's first import: services/credentials.ts captures
// child_process.exec when it loads (promisify), so the wrapper has to be in
// place before then.
//
// No credential value is recorded. A launch keeps only its kind, a program
// label and a SHA-256 of the full command line, which a test compares with
// the hash of the command it configured. A shell-string launch (exec,
// execSync, or anything given a `shell` option) is labelled `shell`, never by
// its first word, which can itself carry a secret (`TOKEN=… printf …`). A
// direct launch is labelled by the program's basename only when that is a
// plain name; anything else is `unrecognised`.

import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import { IS_E2E } from './e2e';

export interface E2eProcessLaunch {
  /** 1, 2, 3… in launch order. */
  seq: number;
  kind: 'exec' | 'execFile' | 'spawn' | 'fork' | 'execSync' | 'execFileSync' | 'spawnSync' | 'openPath' | 'openExternal';
  /** `shell` for a shell-string launch; a direct launch's plain basename, else `unrecognised`; "path" or the URL scheme for the desktop calls. */
  program: string;
  /** SHA-256 of the full command line (or path, or URL). */
  sha256: string;
}

const launches: E2eProcessLaunch[] = [];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function record(kind: E2eProcessLaunch['kind'], program: string, full: string): void {
  launches.push({ seq: launches.length + 1, kind, program, sha256: sha256(full) });
}

/** A shell command string: only its hash identifies it. */
function recordCommand(kind: E2eProcessLaunch['kind'], command: unknown): void {
  record(kind, 'shell', typeof command === 'string' ? command : String(command));
}

/** Whether a launch's options ask for a shell (execFile/spawn take them second or third). */
function usesShell(rest: unknown[]): boolean {
  return rest.some((o) => typeof o === 'object' && o !== null && !Array.isArray(o) && Boolean((o as { shell?: unknown }).shell));
}

/** A program and its arguments. */
function recordFile(kind: E2eProcessLaunch['kind'], a: unknown[]): void {
  const program = typeof a[0] === 'string' ? a[0] : String(a[0]);
  const list = Array.isArray(a[1]) ? a[1].map(String) : [];
  const name = basename(program);
  const label = usesShell(a.slice(1, 3)) ? 'shell' : /^[A-Za-z0-9._+-]{1,64}$/.test(name) ? name : 'unrecognised';
  record(kind, label, JSON.stringify([program, ...list]));
}

/** Every launch so far, as copies. */
export function e2eProcessLaunches(): E2eProcessLaunch[] {
  return launches.map((l) => ({ ...l }));
}

type AnyFn = (...args: unknown[]) => unknown;

// Node's own launch functions call each other (exec calls execFile, which
// calls spawn) through the exported names, so only the outermost call of a
// launch is recorded.
let depth = 0;
function outermost<T>(onCall: () => void, run: () => T): T {
  if (depth === 0) onCall();
  depth++;
  try {
    return run();
  } finally {
    depth--;
  }
}

function wrap(name: keyof typeof childProcess, onCall: (args: unknown[]) => void): void {
  const cp = childProcess as unknown as Record<string, AnyFn & { [promisify.custom]?: AnyFn }>;
  const original = cp[name as string];
  if (typeof original !== 'function') return;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    return outermost(
      () => onCall(args),
      () => original.apply(this, args),
    );
  } as AnyFn & { [promisify.custom]?: AnyFn };
  // exec and execFile promisify to { stdout, stderr } through a custom form; keep it.
  const custom = original[promisify.custom];
  if (typeof custom === 'function') {
    wrapped[promisify.custom] = (...args: unknown[]) =>
      outermost(
        () => onCall(args),
        () => custom(...args),
      );
  }
  cp[name as string] = wrapped;
}

function install(): void {
  wrap('exec', (a) => recordCommand('exec', a[0]));
  wrap('execSync', (a) => recordCommand('execSync', a[0]));
  wrap('execFile', (a) => recordFile('execFile', a));
  wrap('execFileSync', (a) => recordFile('execFileSync', a));
  wrap('spawn', (a) => recordFile('spawn', a));
  wrap('spawnSync', (a) => recordFile('spawnSync', a));
  wrap('fork', (a) => recordFile('fork', a));

  const desktop = shell as unknown as Record<string, AnyFn>;
  const openPath = desktop.openPath;
  desktop.openPath = (...args: unknown[]) => {
    record('openPath', 'path', String(args[0]));
    return openPath.apply(shell, args);
  };
  const openExternal = desktop.openExternal;
  desktop.openExternal = (...args: unknown[]) => {
    const url = String(args[0]);
    const scheme = url.split(':')[0] ?? '';
    record('openExternal', /^[a-z][a-z0-9+.-]{0,31}$/i.test(scheme) ? scheme : 'unrecognised', url);
    return openExternal.apply(shell, args);
  };
}

if (__VERMILIAN_E2E_BUILD__ && IS_E2E) install();

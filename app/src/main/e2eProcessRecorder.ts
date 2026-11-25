// e2e only (VERM-106): records every process the main process launches and
// every path or URL it hands to the desktop, so a packaged test can prove that
// Runway, sort and import actions start no agent, send nothing to tmux and
// never invoke ConTower — while a shell-command credential still runs.
//
// Inert unless VERMILIAN_E2E=1, like the fake YouTrack: outside the e2e
// harness nothing is wrapped and nothing is recorded, and the debug method
// that reads the record is registered only under the harness (main/ipc.ts).
//
// It must be the main entry's first import: services/credentials.ts captures
// child_process.exec when it loads (promisify), so the wrapper has to be in
// place before then.
//
// No credential value is recorded. A launch keeps only its kind, the
// program's basename and a SHA-256 of the full command line, which a test
// compares with the hash of the command it configured.

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
  /** The program's basename (a shell command's first word), or the URL scheme / "path" for the desktop calls. */
  program: string;
  /** SHA-256 of the full command line (or path, or URL). */
  sha256: string;
}

const launches: E2eProcessLaunch[] = [];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function record(kind: E2eProcessLaunch['kind'], program: string, full: string): void {
  launches.push({ seq: launches.length + 1, kind, program, sha256: sha256(full) });
}

/** A shell command string: its first word is the program. */
function recordCommand(kind: E2eProcessLaunch['kind'], command: unknown): void {
  const text = typeof command === 'string' ? command : String(command);
  record(kind, basename(text.trim().split(/\s+/)[0] ?? ''), text);
}

/** A program and its arguments; with `shell`, the "program" may be a whole command line, so only its first word is kept. */
function recordFile(kind: E2eProcessLaunch['kind'], file: unknown, args: unknown): void {
  const program = typeof file === 'string' ? file : String(file);
  const list = Array.isArray(args) ? args.map(String) : [];
  record(kind, basename(program.trim().split(/\s+/)[0] ?? ''), JSON.stringify([program, ...list]));
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
  wrap('execFile', (a) => recordFile('execFile', a[0], a[1]));
  wrap('execFileSync', (a) => recordFile('execFileSync', a[0], a[1]));
  wrap('spawn', (a) => recordFile('spawn', a[0], a[1]));
  wrap('spawnSync', (a) => recordFile('spawnSync', a[0], a[1]));
  wrap('fork', (a) => recordFile('fork', a[0], a[1]));

  const desktop = shell as unknown as Record<string, AnyFn>;
  const openPath = desktop.openPath;
  desktop.openPath = (...args: unknown[]) => {
    record('openPath', 'path', String(args[0]));
    return openPath.apply(shell, args);
  };
  const openExternal = desktop.openExternal;
  desktop.openExternal = (...args: unknown[]) => {
    const url = String(args[0]);
    record('openExternal', url.split(':')[0] ?? '', url);
    return openExternal.apply(shell, args);
  };
}

if (IS_E2E) install();

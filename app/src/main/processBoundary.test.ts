// The Runway, sort and import boundary (VERM-106): which production code can
// launch a process. Only two modules may load child_process: the credential
// resolver, which runs a workspace's shell-command credential, and the e2e
// recorder that watches launches. Anything else — a new agent, tmux or
// ConTower call — would have to add a third, and this test fails first. The
// packaged test (e2e/runway-process-boundary.spec.ts) proves what the running
// app actually does.
//
// Executable paths only: comments, documentation and UI text may mention
// tmux or ConTower.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SRC = join(__dirname, '..');
const ALLOWED = ['main/services/credentials.ts', 'main/e2eProcessRecorder.ts'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Strips comments and the text of string and template literals other than module specifiers. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const LOADS_CHILD_PROCESS = [
  /\bfrom\s+['"](?:node:)?child_process['"]/,
  /\bimport\s+['"](?:node:)?child_process['"]/,
  /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
  /\bimport\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
];

describe('process boundary (VERM-106)', () => {
  it('only the credential resolver and the e2e recorder load child_process, by any import or require', () => {
    const loaders = sources(SRC)
      .filter((p) => LOADS_CHILD_PROCESS.some((re) => re.test(code(readFileSync(p, 'utf8')))))
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .sort();
    expect(loaders).toEqual([...ALLOWED].sort());
  });

  it('the pattern catches every form, and ignores comments', () => {
    const hit = (s: string) => LOADS_CHILD_PROCESS.some((re) => re.test(code(s)));
    expect(hit("import { spawn } from 'node:child_process';")).toBe(true);
    expect(hit('import cp from "child_process";')).toBe(true);
    expect(hit("const cp = require('child_process');")).toBe(true);
    expect(hit("const cp = require ( 'node:child_process' );")).toBe(true);
    expect(hit("const cp = await import('node:child_process');")).toBe(true);
    expect(hit("// import { spawn } from 'node:child_process';")).toBe(false);
    expect(hit("/* require('child_process') */")).toBe(false);
  });
});

describe('the e2e process recorder', () => {
  const originalExec = childProcess.exec;
  afterEach(() => {
    childProcess.exec = originalExec;
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('electron');
  });

  const mockElectron = () => vi.doMock('electron', () => ({ shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => undefined) } }));

  it('is inert outside the e2e harness: nothing is wrapped', async () => {
    vi.stubEnv('VERMILIAN_E2E', '');
    mockElectron();
    const recorder = await import('./e2eProcessRecorder');
    expect(childProcess.exec).toBe(originalExec);
    expect(recorder.e2eProcessLaunches()).toEqual([]);
  });

  it('under the harness, records a launch by program and hash only — never the command text', async () => {
    vi.stubEnv('VERMILIAN_E2E', '1');
    mockElectron();
    const recorder = await import('./e2eProcessRecorder');
    expect(childProcess.exec).not.toBe(originalExec);
    const command = 'printf %s synthetic-secret-value';
    await new Promise<void>((resolve) => childProcess.exec(command, () => resolve()));
    const [launch] = recorder.e2eProcessLaunches();
    expect(launch).toEqual({ seq: 1, kind: 'exec', program: 'printf', sha256: createHash('sha256').update(command).digest('hex') });
    expect(JSON.stringify(recorder.e2eProcessLaunches())).not.toContain('synthetic-secret-value');
  });

  it('a promisified exec, as the credential resolver uses it, is recorded once and still returns { stdout }', async () => {
    vi.stubEnv('VERMILIAN_E2E', '1');
    mockElectron();
    const recorder = await import('./e2eProcessRecorder');
    const { promisify } = await import('node:util');
    const run = promisify(childProcess.exec);
    const out = await run('printf %s synthetic-secret-value');
    expect(out.stdout).toBe('synthetic-secret-value');
    expect(recorder.e2eProcessLaunches().map((l) => [l.kind, l.program])).toEqual([['exec', 'printf']]);
  });
});

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
  // Every function the recorder wraps, restored after each test.
  const WRAPPED = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'] as const;
  const cp = childProcess as unknown as Record<string, unknown>;
  const originals = Object.fromEntries(WRAPPED.map((n) => [n, cp[n]]));
  afterEach(() => {
    for (const n of WRAPPED) cp[n] = originals[n];
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('electron');
  });

  const SECRET = 'synthetic-secret-value';
  const mockElectron = () => vi.doMock('electron', () => ({ shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => undefined) } }));
  async function underHarness() {
    vi.stubEnv('VERMILIAN_E2E', '1');
    mockElectron();
    return import('./e2eProcessRecorder');
  }
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');

  it('is inert outside the e2e harness: nothing is wrapped', async () => {
    vi.stubEnv('VERMILIAN_E2E', '');
    mockElectron();
    const recorder = await import('./e2eProcessRecorder');
    for (const n of WRAPPED) expect(cp[n], n).toBe(originals[n]);
    expect(recorder.e2eProcessLaunches()).toEqual([]);
  });

  it('under the harness wraps every launch function, and the teardown restores them all', async () => {
    await underHarness();
    for (const n of WRAPPED) expect(cp[n], n).not.toBe(originals[n]);
  });

  it('a shell command is labelled shell and kept only as its hash — even when its first word carries the secret', async () => {
    const recorder = await underHarness();
    const command = `TOKEN=${SECRET} printf %s "$TOKEN"`;
    await new Promise<void>((resolve) => childProcess.exec(command, () => resolve()));
    expect(recorder.e2eProcessLaunches()).toEqual([{ seq: 1, kind: 'exec', program: 'shell', sha256: sha(command) }]);
    expect(JSON.stringify(recorder.e2eProcessLaunches())).not.toContain(SECRET);
  });

  it('a promisified exec, as the credential resolver uses it, is recorded once and still returns { stdout }', async () => {
    const recorder = await underHarness();
    const { promisify } = await import('node:util');
    const out = await promisify(childProcess.exec)(`printf %s ${SECRET}`);
    expect(out.stdout).toBe(SECRET);
    expect(recorder.e2eProcessLaunches().map((l) => [l.kind, l.program])).toEqual([['exec', 'shell']]);
    expect(JSON.stringify(recorder.e2eProcessLaunches())).not.toContain(SECRET);
  });

  it('a direct launch keeps a plain program name; a shell option, or a name that is not plain, keeps no text', async () => {
    const recorder = await underHarness();
    childProcess.execFileSync('true');
    childProcess.spawnSync(`TOKEN=${SECRET} true`, [], { shell: true });
    childProcess.spawnSync(`/tmp/run ${SECRET}`, []);
    const events = recorder.e2eProcessLaunches();
    expect(events.map((l) => [l.kind, l.program])).toEqual([
      ['execFileSync', 'true'],
      ['spawnSync', 'shell'],
      ['spawnSync', 'unrecognised'],
    ]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});

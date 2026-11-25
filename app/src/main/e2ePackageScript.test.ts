// e2e/package-e2e-build.sh (VERM-106): the package path is chosen the way the
// Playwright launcher chooses it (process.platform and process.arch), so on
// Windows — where Git Bash's uname says MINGW64_NT-… — it is
// out/Vermilian-win32-x64/resources/app.asar, and packaging is reached in both
// the e2e and the release-isolation modes. The pinned acceptance build is
// still refused.
//
// The real script runs from a scratch app directory, with stand-ins first on
// PATH: uname as Git Bash on Windows reports it; node answering win32-x64 to
// the platform question (the real node for anything else, such as hashing);
// and pnpm recording how packaging was called, then writing the package's
// app.asar where Electron Forge would.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '../../e2e/package-e2e-build.sh');
const WINDOWS_ASAR = 'out/Vermilian-win32-x64/resources/app.asar';
const REAL_NODE = process.execPath;

let root: string;
let app: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verm106-pkg-'));
  app = join(root, 'app');
  bin = join(root, 'bin');
  mkdirSync(join(app, 'e2e'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(SCRIPT, join(app, 'e2e', 'package-e2e-build.sh'));
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('uname', 'case "$1" in -m) echo x86_64 ;; *) echo MINGW64_NT-10.0-19045 ;; esac');
  // FAIL_HASH=always fails every hash read; FAIL_HASH=after-pack only once packaging has run.
  stub(
    'node',
    [
      `if [ "$1" = -p ] && [[ "$2" == *process.platform* ]]; then echo win32-x64; exit 0; fi`,
      `if [[ "$*" == *createHash* ]]; then`,
      `  if [ "\${FAIL_HASH:-}" = always ] || { [ "\${FAIL_HASH:-}" = after-pack ] && [ -f "${join(root, 'packaged')}" ]; }; then echo "EACCES: permission denied" >&2; exit 1; fi`,
      `fi`,
      `exec "${REAL_NODE}" "$@"`,
    ].join('\n'),
  );
  stub(
    'pnpm',
    `echo "pnpm $* VERMILIAN_E2E_BUILD=\${VERMILIAN_E2E_BUILD-unset} cwd=$(pwd)" >> "${join(root, 'pnpm.log')}"\nmkdir -p out/Vermilian-win32-x64/resources\necho "packaged" > ${WINDOWS_ASAR}\ntouch "${join(root, 'packaged')}"`,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[] = [], failHash = '') {
  return spawnSync('bash', [join(app, 'e2e', 'package-e2e-build.sh'), ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VERMILIAN_E2E_BUILD: '', FAIL_HASH: failHash },
    encoding: 'utf8',
  });
}
const MODES: [string, string[]][] = [
  ['e2e', []],
  ['release', ['--release']],
];
const existingBuild = () => {
  mkdirSync(join(app, 'out/Vermilian-win32-x64/resources'), { recursive: true });
  writeFileSync(join(app, WINDOWS_ASAR), 'an existing build');
};
const pnpmCalls = () => (existsSync(join(root, 'pnpm.log')) ? readFileSync(join(root, 'pnpm.log'), 'utf8').trim().split('\n') : []);

describe('e2e/package-e2e-build.sh on Windows x64 (VERM-106)', () => {
  it('the stand-ins answer as Git Bash on Windows would', () => {
    expect(execFileSync(join(bin, 'uname'), [], { encoding: 'utf8' }).trim()).toBe('MINGW64_NT-10.0-19045');
  });

  it('e2e mode selects out/Vermilian-win32-x64/resources/app.asar and packages with VERMILIAN_E2E_BUILD=1', () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(pnpmCalls()).toEqual([`pnpm exec electron-forge package VERMILIAN_E2E_BUILD=1 cwd=${app}`]);
    expect(r.stdout).toContain(`E2e build: ${WINDOWS_ASAR}`);
  });

  it('release-isolation mode selects the same path and packages without the flag', () => {
    const r = run(['--release']);
    expect(r.status, r.stderr).toBe(0);
    expect(pnpmCalls()).toEqual([`pnpm exec electron-forge package VERMILIAN_E2E_BUILD=unset cwd=${app}`]);
    expect(r.stdout).toContain(`Release build: ${WINDOWS_ASAR}`);
  });

  it('the pinned acceptance build at that path is still refused, in both modes, and nothing is packaged', () => {
    // A build at the Windows path, made "pinned" by giving the scratch copy of the script its hash.
    mkdirSync(join(app, 'out/Vermilian-win32-x64/resources'), { recursive: true });
    writeFileSync(join(app, WINDOWS_ASAR), 'the build Kevin is testing');
    const pinned = createHash('sha256').update('the build Kevin is testing').digest('hex');
    const copy = join(app, 'e2e', 'package-e2e-build.sh');
    writeFileSync(copy, readFileSync(copy, 'utf8').replace(/^PINNED_ASAR_SHA256=.*$/m, `PINNED_ASAR_SHA256=${pinned}`));
    for (const args of [[], ['--release']]) {
      const r = run(args);
      expect(r.status, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(3);
      expect(r.stderr).toContain(`REFUSED: ${WINDOWS_ASAR} is the pinned acceptance build`);
    }
    expect(pnpmCalls()).toEqual([]);
    expect(readFileSync(join(app, WINDOWS_ASAR), 'utf8')).toBe('the build Kevin is testing');
  });

  it.each(MODES)('%s mode: when an existing app.asar cannot be hashed, it exits non-zero before packaging and leaves the file untouched', (_mode, args) => {
    existingBuild();
    const r = run(args, 'always');
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stderr).toContain(`REFUSED: could not read the checksum of ${WINDOWS_ASAR}`);
    expect(pnpmCalls()).toEqual([]);
    expect(readFileSync(join(app, WINDOWS_ASAR), 'utf8')).toBe('an existing build');
  });

  it.each(MODES)('%s mode: when the newly built app.asar cannot be hashed, it exits non-zero and prints no success', (mode, args) => {
    const r = run(args, 'after-pack');
    expect(pnpmCalls()).toHaveLength(1);
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stderr).toContain(`could not read the checksum of the new build ${WINDOWS_ASAR}`);
    expect(r.stdout).not.toContain(mode === 'e2e' ? 'E2e build:' : 'Release build:');
  });
});

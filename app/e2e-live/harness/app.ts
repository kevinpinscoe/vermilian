/**
 * Launches the real application against a live server, with its own isolated
 * profile and explicit evidence capture.
 *
 * Electron windows opened through `_electron.launch()` are not covered by the
 * Playwright `use: { trace, screenshot, video }` page-fixture options, so
 * tracing, console capture and main-process output are configured here on
 * the ElectronApplication's own context.
 */

import { _electron as electron, ElectronApplication, Page, TestInfo } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HarnessError, redact } from './clients';
import { ELECTRON_ARGS } from './identity';
import type { LiveSettings } from './settings';

export const HARNESS_WORKSPACE_ID = 'workspace-live-harness';

/** Application state files copied into the evidence at the end of a scenario. */
const PROFILE_EVIDENCE_FILES = ['app-config.json', 'workspace-config.json', 'timer-state.json', 'article-config-id.txt'];

/** A fresh temporary profile directory (kept out of the evidence tree: Chromium caches are large). */
export function tempProfileDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-live-profile-'));
}

export interface ProfileSeed {
  /** null = launch unconfigured (no server at all), used by the harness self-test. */
  server: { url: string; login: string; tokenCommand: string } | null;
  projectIds: string[];
}

/** Writes app-config.json and workspace-config.json into a fresh profile directory. */
export function seedProfile(dir: string, seed: ProfileSeed): void {
  fs.mkdirSync(dir, { recursive: true });
  if (seed.server) {
    fs.writeFileSync(path.join(dir, 'app-config.json'), JSON.stringify({
      youtrackUrl: seed.server.url,
      youtrackLogin: seed.server.login,
      youtrackTokenCommand: seed.server.tokenCommand,
    }, null, 2));
  }
  fs.writeFileSync(path.join(dir, 'workspace-config.json'), JSON.stringify({
    version: 1,
    workspaces: [{
      id: HARNESS_WORKSPACE_ID,
      name: 'Live harness',
      order: 0,
      folders: [{ id: 'folder-live-harness', name: 'Projects', order: 0, parentId: null, projectIds: seed.projectIds }],
    }],
    activeWorkspaceId: HARNESS_WORKSPACE_ID,
  }, null, 2));
}

/** The app's environment: the runner's, minus every fake-service switch. */
export function liveEnv(): { env: Record<string, string>; removed: string[] } {
  const env: Record<string, string> = {};
  const removed: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('VERMILIAN_E2E')) { removed.push(k); continue; }
    env[k] = v;
  }
  return { env, removed };
}

export class LiveApp {
  app!: ElectronApplication;
  page!: Page;
  private launches = 0;
  private log: string[] = [];
  // Our own handle on the child process: ElectronApplication.process() throws
  // once the app has closed, and several paths here run after that.
  private proc: ChildProcess | null = null;
  private exitCode: number | null = null;
  private running = false;

  constructor(
    private readonly settings: LiveSettings,
    private readonly testInfo: TestInfo,
    readonly profileDir: string,
  ) {}

  private stamp(line: string) {
    this.log.push(`${new Date().toISOString()} ${redact(line)}`);
  }

  async launch(): Promise<Page> {
    this.launches += 1;
    const n = this.launches;
    const { env, removed } = liveEnv();
    this.stamp(`launch #${n}: ${this.settings.executable} --user-data-dir=${this.profileDir} ${ELECTRON_ARGS.join(' ')}; removed from env: ${removed.join(', ') || 'none'}`);
    this.app = await electron.launch({
      executablePath: this.settings.executable,
      args: [`--user-data-dir=${this.profileDir}`, ...ELECTRON_ARGS],
      env,
    });
    const proc = this.app.process();
    this.proc = proc;
    this.running = true;
    this.exitCode = null;
    proc.once('exit', (code) => { this.running = false; this.exitCode = code; });
    proc.stdout?.on('data', (d) => this.stamp(`[main stdout #${n}] ${String(d).trimEnd()}`));
    proc.stderr?.on('data', (d) => this.stamp(`[main stderr #${n}] ${String(d).trimEnd()}`));
    await this.app.context().tracing.start({ screenshots: true, snapshots: true, title: `${this.testInfo.title} — launch ${n}` });
    this.page = await this.app.firstWindow();
    this.page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') this.stamp(`[renderer ${m.type()} #${n}] ${m.text()}`); });
    this.page.on('pageerror', (e) => this.stamp(`[renderer pageerror #${n}] ${e.message}`));

    // Fake-service mode must be off in the process actually running.
    const fakeVars = await this.app.evaluate(() => Object.keys(process.env).filter((k) => k.startsWith('VERMILIAN_E2E')));
    if (fakeVars.length) throw new HarnessError(`fake-service variables reached the app: ${fakeVars.join(', ')}`);
    this.stamp(`launch #${n}: confirmed no VERMILIAN_E2E* variable in the main process`);
    return this.page;
  }

  async screenshot(name: string): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    const file = this.testInfo.outputPath(`${name}.png`);
    await this.page.screenshot({ path: file }).catch(() => undefined);
    await this.testInfo.attach(name, { path: file, contentType: 'image/png' }).catch(() => undefined);
  }

  private traceStopped = 0;

  /** Saves this launch's trace. Call before anything that makes the app exit on its own. */
  async stopTrace(): Promise<void> {
    const n = this.launches;
    if (this.traceStopped === n) return;
    this.traceStopped = n;
    const trace = this.testInfo.outputPath(`trace-launch-${n}.zip`);
    try {
      await this.app.context().tracing.stop({ path: trace });
    } catch (e) {
      this.stamp(`trace stop failed for launch #${n}: ${(e as Error).message}`);
    }
    if (fs.existsSync(trace)) await this.testInfo.attach(`trace-launch-${n}`, { path: trace, contentType: 'application/zip' });
  }

  /** Saves the trace and asks the app to quit; returns how the process ended. */
  async close(reason: string): Promise<{ exitCode: number | null; forced: boolean }> {
    const n = this.launches;
    await this.screenshot(`launch-${n}-before-close`);
    await this.stopTrace();
    const proc = this.proc!;
    const exited = this.waitForExit(30_000).catch(() => null);
    this.stamp(`close #${n} (${reason})`);
    let forced = false;
    const closed = await Promise.race([
      this.app.close().then(() => true).catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 15_000)),
    ]);
    if (!closed && this.running) {
      forced = true;
      this.stamp(`close #${n}: app did not exit within 15 s; sending SIGKILL`);
      proc.kill('SIGKILL');
    }
    const exitCode = await exited;
    this.stamp(`close #${n}: process exited with ${exitCode}${forced ? ' after SIGKILL' : ''}`);
    return { exitCode, forced };
  }

  /** Quits through the app's own quit path (the one Ctrl+Q uses), not Playwright's close. */
  async requestQuit(): Promise<void> {
    this.stamp(`requesting app.quit() in launch #${this.launches}`);
    await this.app.evaluate(({ app }) => { app.quit(); });
  }

  async waitForExit(timeoutMs = 20_000): Promise<number | null> {
    const proc = this.proc!;
    if (!this.running) return this.exitCode;
    return Promise.race([
      new Promise<number | null>((resolve) => proc.once('exit', (c) => resolve(c))),
      new Promise<number | null>((_, reject) => setTimeout(() => reject(new Error(`app did not exit within ${timeoutMs} ms`)), timeoutMs)),
    ]);
  }

  async finish(): Promise<void> {
    try {
      if (this.app && this.running) await this.close('end of test');
      else if (this.app) await this.stopTrace();
    } finally {
      // Keep the application's own state files as evidence; the rest of the
      // Electron profile (Chromium caches) stays in the temporary directory.
      const snap = this.testInfo.outputPath('profile-files');
      fs.mkdirSync(snap, { recursive: true });
      for (const name of PROFILE_EVIDENCE_FILES) {
        const src = path.join(this.profileDir, name);
        if (fs.existsSync(src)) fs.writeFileSync(path.join(snap, name), redact(fs.readFileSync(src, 'utf-8')));
      }
      const file = this.testInfo.outputPath('app-log.txt');
      fs.writeFileSync(file, this.log.join('\n') + '\n');
      await this.testInfo.attach('app-log', { path: file, contentType: 'text/plain' });
    }
  }
}

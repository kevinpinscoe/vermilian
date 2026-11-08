/**
 * Live acceptance harness settings. Everything comes from the environment so
 * that no server, account, project or credential command is baked into the
 * repository. See e2e-live/README.md for what each variable means.
 *
 * Nothing here has a default that points at a real account or project: a
 * missing value makes the preflight report the scenario as Blocked, never
 * guess.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export interface LiveSettings {
  /** YouTrack base URL the application under test is configured with. */
  appUrl: string;
  /** Login the application's token must resolve to (a dedicated harness account). */
  appLogin: string;
  /**
   * How the app gets the harness account's token: exactly one of these two.
   * - a shell command whose stdout is the token, run by the app and by the preflight;
   * - a file holding the token, such as the RAM-backed file `parzival exec` renders
   *   for the duration of the run.
   * Neither value is the token itself, and the token is never recorded.
   */
  appTokenCommand: string;
  appTokenFile: string;
  /** Harness project short name — time tracking enabled, in none of Kevin's workspaces. */
  project: string;
  /** Second harness project short name — time tracking disabled, used for B9's rejected-worklog case. */
  rejectProject: string;
  /** Base URL the independent verifier uses (may differ from appUrl, e.g. loopback). */
  verifierUrl: string;
  /** parzival identity label and profile for the independent verifier. */
  verifierAs: string;
  verifierProfile: string;
  /** Logins the application identity must never be (Kevin's own, the verifier's). */
  forbiddenLogins: string[];
  /**
   * Accept the inherited "Registered Users: Observer in GLBL" role as read-only Hub
   * permissions held globally (see isolation.ts). Off by default: strict isolation.
   * Set VERMILIAN_LIVE_ACCEPT_GLBL_OBSERVER=1 only with Kevin's approval.
   */
  acceptGlblObserver: boolean;
  /** Status names used for fixture reset and for E8. */
  openState: string;
  doneState: string;
  /** Executable of the build under test. */
  executable: string;
  /** Root directory for this run's evidence. */
  evidenceDir: string;
}

const APP_DIR = path.resolve(__dirname, '../..');

export function defaultExecutable(): string {
  const outDir = path.join(APP_DIR, 'out', `Vermilian-${process.platform}-${process.arch}`);
  switch (process.platform) {
    case 'darwin':
      return path.join(outDir, 'Vermilian.app', 'Contents', 'MacOS', 'Vermilian');
    case 'win32':
      return path.join(outDir, 'Vermilian.exe');
    default:
      return path.join(outDir, 'Vermilian');
  }
}

function utcStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Resolved once per process and shared with the reporter through the
// environment, so the config, the reporter and every worker agree on the
// same run directory.
function resolveEvidenceDir(): string {
  if (!process.env.VERMILIAN_LIVE_RUN_DIR) {
    const root = process.env.VERMILIAN_LIVE_EVIDENCE_DIR
      ? process.env.VERMILIAN_LIVE_EVIDENCE_DIR.replace(/^~(?=$|\/)/, os.homedir())
      : path.join(APP_DIR, 'live-results');
    process.env.VERMILIAN_LIVE_RUN_DIR = path.join(root, utcStamp());
  }
  fs.mkdirSync(process.env.VERMILIAN_LIVE_RUN_DIR, { recursive: true });
  return process.env.VERMILIAN_LIVE_RUN_DIR;
}

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export function loadSettings(): LiveSettings {
  const verifierLogins = env('VERMILIAN_LIVE_FORBIDDEN_LOGINS', 'admin,Claude_Code')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return {
    appUrl: env('VERMILIAN_LIVE_YOUTRACK_URL').replace(/\/+$/, ''),
    appLogin: env('VERMILIAN_LIVE_APP_LOGIN'),
    appTokenCommand: env('VERMILIAN_LIVE_APP_TOKEN_COMMAND'),
    appTokenFile: env('VERMILIAN_LIVE_APP_TOKEN_FILE'),
    project: env('VERMILIAN_LIVE_PROJECT'),
    rejectProject: env('VERMILIAN_LIVE_REJECT_PROJECT'),
    verifierUrl: env('VERMILIAN_LIVE_VERIFIER_URL', 'http://127.0.0.1:9000').replace(/\/+$/, ''),
    verifierAs: env('VERMILIAN_LIVE_VERIFIER_AS', 'ai'),
    verifierProfile: env('VERMILIAN_LIVE_VERIFIER_PROFILE', 'youtrack-claude-code'),
    forbiddenLogins: verifierLogins,
    acceptGlblObserver: env('VERMILIAN_LIVE_ACCEPT_GLBL_OBSERVER') === '1',
    openState: env('VERMILIAN_LIVE_OPEN_STATE', 'To do'),
    doneState: env('VERMILIAN_LIVE_DONE_STATE', 'Done'),
    executable: env('VERMILIAN_LIVE_EXECUTABLE') || defaultExecutable(),
    evidenceDir: resolveEvidenceDir(),
  };
}

/** Variables that must be present before any scenario touches the server. */
export function missingSettings(s: LiveSettings): string[] {
  const required: Array<[keyof LiveSettings, string]> = [
    ['appUrl', 'VERMILIAN_LIVE_YOUTRACK_URL'],
    ['appLogin', 'VERMILIAN_LIVE_APP_LOGIN'],
    ['project', 'VERMILIAN_LIVE_PROJECT'],
    ['rejectProject', 'VERMILIAN_LIVE_REJECT_PROJECT'],
  ];
  const missing = required.filter(([k]) => !s[k]).map(([, name]) => name);
  if (!s.appTokenCommand && !s.appTokenFile) missing.push('VERMILIAN_LIVE_APP_TOKEN_FILE or VERMILIAN_LIVE_APP_TOKEN_COMMAND');
  if (s.appTokenCommand && s.appTokenFile) missing.push('only one of VERMILIAN_LIVE_APP_TOKEN_FILE and VERMILIAN_LIVE_APP_TOKEN_COMMAND (both are set)');
  return missing;
}

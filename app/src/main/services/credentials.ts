// Credential loading with three-source priority chain (updated from ADR-0004):
//   1. Shell command  — stdout of a user-configured command (1Password, OpenBao, pass, etc.)
//   2. File path      — content of a user-configured file path
//   3. safeStorage    — Electron encrypted blob (original approach; may fail on Linux
//                       without a keyring daemon)
//
// All IPC callers should use loadSecretWithSources() / hasSecretWithSources() rather
// than the bare loadSecret() / hasSecret() so that the priority chain is honoured.

import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const FILES = {
  youtrackToken: 'youtrack.token.bin',
  claudeKey: 'claude.key.bin',
} as const;

const SECURE_LINUX_BACKENDS = new Set([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
]);

function credentialsDir(): string {
  return path.join(app.getPath('userData'), 'credentials');
}

export function getBackend(): string {
  if (process.platform === 'linux') {
    return safeStorage.getSelectedStorageBackend();
  }
  return 'os';
}

export function isSecure(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux') return SECURE_LINUX_BACKENDS.has(getBackend());
  return true;
}

async function atomicWrite(file: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

// ─── Source 3: safeStorage (original approach) ────────────────────────────────

export async function saveSecret(
  filename: string,
  plaintext: string,
): Promise<{ ok: boolean; backend?: string }> {
  // On Linux without a secure keyring backend, bail early — there is nothing
  // to try. On macOS and Windows the OS always provides encryption so we skip
  // the isSecure() guard: macOS 26 / some Electron builds return false from
  // isEncryptionAvailable() even though encryptString() still succeeds.
  if (process.platform === 'linux' && !isSecure()) {
    return { ok: false, backend: getBackend() };
  }
  try {
    const encrypted = safeStorage.encryptString(plaintext.trim());
    await atomicWrite(path.join(credentialsDir(), filename), encrypted);
    return { ok: true };
  } catch {
    return { ok: false, backend: getBackend() };
  }
}

export async function loadSecret(filename: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(path.join(credentialsDir(), filename));
    const val = safeStorage.decryptString(buf).trim();
    return val || null;
  } catch {
    return null;
  }
}

export async function hasSecret(filename: string): Promise<boolean> {
  // Verify the file both exists AND can actually be decrypted — a file that
  // can't be decrypted (e.g. encrypted under a different Electron key) is
  // effectively absent from the user's perspective.
  const val = await loadSecret(filename);
  return val !== null;
}

// ─── Source 1: shell command ──────────────────────────────────────────────────

async function runCommand(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10_000 });
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

// ─── Source 2: file path ─────────────────────────────────────────────────────

async function readFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath.trim(), 'utf-8');
    const value = content.trim();
    return value || null;
  } catch {
    return null;
  }
}

// ─── Three-source priority chain ─────────────────────────────────────────────

/**
 * Load a credential using the configured priority chain:
 *   command → file → safeStorage blob
 *
 * @param filename  safeStorage blob filename (fallback)
 * @param command   shell command whose stdout is the credential ('' = skip)
 * @param filePath  file whose content is the credential ('' = skip)
 */
export async function loadSecretWithSources(
  filename: string,
  command: string,
  filePath: string,
): Promise<string | null> {
  if (command.trim()) {
    const val = await runCommand(command.trim());
    if (val) return val;
  }
  if (filePath.trim()) {
    const val = await readFile(filePath.trim());
    if (val) return val;
  }
  return loadSecret(filename);
}

/**
 * Check whether a credential is likely available using the configured chain.
 * For the command source we trust the user's configuration without executing it.
 * For the file source we check file existence. For safeStorage we check the blob.
 */
export async function hasSecretWithSources(
  filename: string,
  command: string,
  filePath: string,
): Promise<boolean> {
  if (command.trim()) return true; // trust user's configuration
  if (filePath.trim()) {
    try {
      await fs.access(filePath.trim());
      return true;
    } catch { /* fall through */ }
  }
  return hasSecret(filename);
}

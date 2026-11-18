// Credential loading with three-source priority chain (updated from ADR-0004):
//   1. Shell command  — stdout of a user-configured command (1Password, OpenBao, pass, etc.)
//   2. File path      — content of a user-configured file path
//   3. safeStorage    — Electron encrypted blob (original approach; may fail on Linux
//                       without a keyring daemon)
// The highest configured source is the only one read; a failure does not fall
// through to a lower one (VERM-57).
//
// All IPC callers should use loadSecretWithSources() / hasSecretWithSources() rather
// than the bare loadSecret() / hasSecret() so that the priority chain is honoured.

import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import {
  blobFilenameFor,
  checkCredentialValue,
  describeSourceFailure,
  isLegacyCredentialRef,
  legacyRefForBlob,
  openBaoSourceFor,
  refFromBlobFilename,
  selectSource,
  type CredentialFailureReason,
  type CredentialSourceKind,
} from '../../shared/credentialRefs';
import { isCredentialRef } from '../../shared/workspaceSchema';
import type { CredentialRefWriteResult } from '../../shared/ipc';
import type { CredentialSourceIO } from './credentialResolver';
import { readConfig } from './config';
import { createOpenBaoClient } from './openbaoClient';
import { SETTINGS_SCOPE_ID, type OpenBaoFailureReason } from '../../shared/openbao';

const execAsync = promisify(exec);

export const FILES = {
  youtrackToken: 'youtrack.token.bin',
  claudeKey: 'claude.key.bin',
  jiraToken: 'jira.token.bin',
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

// ─── Source 3: safeStorage (encrypted) ───────────────────────────────────────

// Plain-text copy left by versions before VERM-57, which wrote one whenever
// safeStorage could not encrypt. Nothing writes it now: it is only read until
// encryptPlaintextSecrets() can replace it with an encrypted blob.
function plaintextPath(filename: string): string {
  return path.join(credentialsDir(), filename.replace(/\.bin$/, '.txt'));
}

/**
 * Saves a credential as an encrypted safeStorage blob and removes any
 * plain-text copy, so exactly one copy is left. Where safeStorage cannot
 * encrypt, nothing is written: the user is pointed to the command or file
 * source instead (VERM-57).
 */
export async function saveSecret(
  filename: string,
  plaintext: string,
): Promise<{ ok: boolean; backend?: string }> {
  if (!isSecure()) return { ok: false, backend: getBackend() };
  try {
    const encrypted = safeStorage.encryptString(plaintext.trim());
    await atomicWrite(path.join(credentialsDir(), filename), encrypted);
  } catch {
    return { ok: false, backend: getBackend() };
  }
  await fs.unlink(plaintextPath(filename)).catch(() => {});
  return { ok: true };
}

export async function loadSecret(filename: string): Promise<string | null> {
  const r = await credentialSourceIO.readBlob(filename, true);
  if (!r.ok) return null;
  return r.value.trim() || null;
}

export async function hasSecret(filename: string): Promise<boolean> {
  // A blob that can't be decrypted (e.g. encrypted under a different Electron
  // key) is effectively absent from the user's perspective.
  const val = await loadSecret(filename);
  return val !== null;
}

/** Where a legacy credential's blob tier stands on this host, for Settings. */
export type LegacySecretStorage = 'none' | 'encrypted' | 'plaintext' | 'undecryptable';

export async function legacySecretStorage(filename: string): Promise<LegacySecretStorage> {
  if (await exists(plaintextPath(filename))) return 'plaintext';
  if (!(await exists(path.join(credentialsDir(), filename)))) return 'none';
  return (await loadSecret(filename)) === null ? 'undecryptable' : 'encrypted';
}

/**
 * Replaces each legacy plain-text copy with an encrypted blob — overwriting
 * any older blob, which the plain-text copy always postdates — and deletes it.
 * A copy is kept unless the new blob decrypts back to the same value.
 */
export async function encryptPlaintextSecrets(): Promise<{ encrypted: string[]; failed: string[] }> {
  const encrypted: string[] = [];
  const failed: string[] = [];
  for (const filename of Object.values(FILES)) {
    let value: string;
    try {
      value = (await fs.readFile(plaintextPath(filename), 'utf-8')).trim();
    } catch {
      continue;
    }
    try {
      if (!isSecure() || checkCredentialValue(value) !== 'ok') throw new Error('not encryptable');
      const blob = safeStorage.encryptString(value);
      if (safeStorage.decryptString(blob) !== value) throw new Error('round trip failed');
      await atomicWrite(path.join(credentialsDir(), filename), blob);
      await fs.unlink(plaintextPath(filename));
      encrypted.push(filename);
    } catch {
      failed.push(filename);
    }
  }
  return { encrypted, failed };
}

// ─── Three-source priority chain ─────────────────────────────────────────────

export type LegacySecretResolution =
  | { ok: true; value: string; source: CredentialSourceKind }
  | { ok: false; source: CredentialSourceKind | null; reason: CredentialFailureReason; message: string };

/**
 * Resolves a Settings credential the way credentialResolver.ts resolves a
 * workspace reference: the highest-priority configured source — command, then
 * file, then safeStorage blob — is the only one read. A failing command or
 * file does not fall through to a stored value (VERM-57), so Settings → Test
 * and workspace activation agree.
 *
 * @param filename  safeStorage blob filename
 * @param command   shell command whose stdout is the credential ('' = skip)
 * @param filePath  file whose content is the credential ('' = skip)
 */
export async function resolveLegacySecret(
  filename: string,
  command: string,
  filePath: string,
): Promise<LegacySecretResolution> {
  const io = credentialSourceIO;
  // A Settings credential switched to OpenBao reads nothing else (VERM-64).
  const legacyRef = legacyRefForBlob(filename);
  const bao = legacyRef ? openBaoSourceFor(legacyRef, SETTINGS_SCOPE_ID, await readConfig()) : null;
  if (bao) {
    const r = await openBaoClient.readField(bao.scopeId, bao.scope, bao.binding);
    const failed = (reason: CredentialFailureReason): LegacySecretResolution =>
      ({ ok: false, source: 'openbao', reason, message: describeSourceFailure('openbao', reason) });
    if (!r.ok) return failed(`openbao-${r.reason as OpenBaoFailureReason}`);
    const value = r.value.trim();
    const check = checkCredentialValue(value);
    return check === 'ok' ? { ok: true, value, source: 'openbao' } : failed(check);
  }
  const sources = { command, file: filePath };
  const needBlobCheck = !command.trim() && !filePath.trim();
  const source = selectSource(sources, needBlobCheck ? await io.blobPresent(filename, true) : false);
  const fail = (s: CredentialSourceKind | null, reason: CredentialFailureReason): LegacySecretResolution =>
    ({ ok: false, source: s, reason, message: describeSourceFailure(s, reason) });
  if (source === null) return fail(null, 'no-source');

  let raw: string;
  if (source === 'command') {
    const r = await io.runCommand(command.trim());
    if (!r.ok) return fail(source, 'command-failed');
    raw = r.stdout;
  } else if (source === 'file') {
    const r = await io.readFile(filePath.trim());
    if (!r.ok) return fail(source, 'file-unreadable');
    raw = r.content;
  } else {
    const r = await io.readBlob(filename, true);
    if (!r.ok) return fail(source, 'blob-unreadable');
    raw = r.value;
  }
  const value = raw.trim();
  const check = checkCredentialValue(value);
  if (check !== 'ok') return fail(source, check);
  return { ok: true, value, source };
}

/** The value resolveLegacySecret() yields, or null when it fails. */
export async function loadSecretWithSources(
  filename: string,
  command: string,
  filePath: string,
): Promise<string | null> {
  const r = await resolveLegacySecret(filename, command, filePath);
  return r.ok ? r.value : null;
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
  const legacyRef = legacyRefForBlob(filename);
  if (legacyRef && openBaoSourceFor(legacyRef, SETTINGS_SCOPE_ID, await readConfig())) return true;
  if (command.trim()) return true; // trust user's configuration
  if (filePath.trim()) {
    try {
      await fs.access(filePath.trim());
      return true;
    } catch { /* fall through */ }
  }
  return hasSecret(filename);
}

// ─── Per-reference credentials (ADR-0011 §5, VERM-45) ────────────────────────
//
// The raw source reads behind credentialResolver.ts, and the per-reference
// blob store. Unlike the legacy chain above, nothing here falls through: each
// read reports only whether it worked, and the resolver stops on the first
// configured source that fails.

/** OpenBao access for this process; the login secret comes from a command or file (VERM-64). */
export const openBaoClient = createOpenBaoClient({
  fetch: (input, init) => fetch(input, init),
  async readAuthSecret(auth) {
    if (auth.secretCommand) {
      const r = await credentialSourceIO.runCommand(auth.secretCommand);
      return r.ok ? r.stdout : null;
    }
    const r = await credentialSourceIO.readFile(auth.secretFile);
    return r.ok ? r.content : null;
  },
});

/** Electron/Node reads for credentialResolver.ts. */
export const credentialSourceIO: CredentialSourceIO = {
  readOpenBao: (scopeId, conn, binding) => openBaoClient.readField(scopeId, conn, binding),
  async runCommand(command) {
    try {
      const { stdout } = await execAsync(command, { timeout: 10_000 });
      return { ok: true, stdout };
    } catch {
      return { ok: false };
    }
  },
  async readFile(filePath) {
    try {
      return { ok: true, content: await fs.readFile(filePath, 'utf-8') };
    } catch {
      return { ok: false };
    }
  },
  async blobPresent(filename, legacy) {
    if (await exists(path.join(credentialsDir(), filename))) return true;
    // A legacy credential saved where safeStorage encryption failed (macOS)
    // lives in its plain-text fallback file; per-reference blobs never do.
    return legacy && (await exists(plaintextPath(filename)));
  },
  async readBlob(filename, legacy) {
    // A legacy plain-text copy is always newer than the blob beside it: a
    // successful encrypted save deletes it, and the old fallback write left
    // the blob in place. Reading the blob first returned a stale secret.
    if (legacy && (await exists(plaintextPath(filename)))) {
      try {
        return { ok: true, value: await fs.readFile(plaintextPath(filename), 'utf-8') };
      } catch {
        return { ok: false };
      }
    }
    const encrypted = path.join(credentialsDir(), filename);
    if (await exists(encrypted)) {
      // An encrypted blob that cannot be decrypted is a failure, not a reason
      // to read the plain-text file instead.
      try {
        return { ok: true, value: safeStorage.decryptString(await fs.readFile(encrypted)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  },
};

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a per-reference credential as an encrypted safeStorage blob. Refuses
 * a legacy reference (those keep their own Settings fields and blobs), a value
 * that is not a single credential, and — unlike saveSecret — any host where
 * safeStorage cannot encrypt: there is no plain-text fallback for a reference.
 */
export async function saveCredentialRefSecret(
  ref: string,
  value: string,
): Promise<CredentialRefWriteResult> {
  if (!isCredentialRef(ref)) return { ok: false, reason: 'invalid-reference' };
  if (isLegacyCredentialRef(ref)) return { ok: false, reason: 'legacy-reference' };
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (checkCredentialValue(trimmed) !== 'ok') return { ok: false, reason: 'invalid-value' };
  if (!isSecure()) return { ok: false, reason: 'encryption-unavailable' };
  let encrypted: Buffer;
  try {
    encrypted = safeStorage.encryptString(trimmed);
  } catch {
    return { ok: false, reason: 'encryption-unavailable' };
  }
  try {
    await atomicWrite(path.join(credentialsDir(), blobFilenameFor(ref)), encrypted);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}

/** Deletes a per-reference blob. Refuses a legacy reference. Absent is success. */
export async function clearCredentialRefSecret(ref: string): Promise<CredentialRefWriteResult> {
  if (!isCredentialRef(ref)) return { ok: false, reason: 'invalid-reference' };
  if (isLegacyCredentialRef(ref)) return { ok: false, reason: 'legacy-reference' };
  try {
    await fs.unlink(path.join(credentialsDir(), blobFilenameFor(ref)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, reason: 'write-failed' };
  }
  return { ok: true };
}

/** Deletes a Settings credential's saved blob and any plain-text copy. Absent is success. */
export async function clearLegacySecret(filename: string): Promise<boolean> {
  try {
    await fs.rm(path.join(credentialsDir(), filename), { force: true });
    await fs.rm(plaintextPath(filename), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** References that have a per-reference blob on this host. */
export async function listCredentialRefBlobs(): Promise<string[]> {
  try {
    const names = await fs.readdir(credentialsDir());
    return names.map(refFromBlobFilename).filter((r): r is string => r !== null);
  } catch {
    return [];
  }
}

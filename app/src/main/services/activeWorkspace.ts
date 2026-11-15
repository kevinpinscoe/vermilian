// Per-machine active workspace (VERM-46, ADR-0011 §2) and the activation gate
// for per-workspace configuration storage.
//
// The active workspace ID lives in userData/active-workspace.json — local to
// this machine, never written to the shared _vermilian-config article. It is a
// file of its own, not a field in app-config.json, so a Settings save carrying
// an older snapshot of AppConfig can never overwrite the choice.

import { app } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { IS_E2E } from '../e2e';
import {
  LEGACY_LOCAL_STATE,
  LOCAL_STORAGE_STATE_SCHEMA,
  parseLocalStorageState,
  type LocalStorageState,
  type WorkspaceStorageMode,
} from '../../shared/storageActivation';

function filePath(): string {
  return path.join(app.getPath('userData'), 'active-workspace.json');
}

export async function readStoredActiveWorkspaceId(): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), 'utf8')) as { activeWorkspaceId?: unknown };
    return typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : '';
  } catch {
    return '';
  }
}

// Bumped synchronously, before any await, every time the active workspace is
// written, so an AI operation can tell that a switch happened while it was
// resolving a credential or loading issues (VERM-47, services/workspaceAiKey.ts).
// Every write counts, even one naming the same workspace: refusing an AI
// request is always safe; sending it for the wrong workspace is not.
let activeGeneration = 0;

/** How many times the active workspace has been written since start-up. */
export function activeWorkspaceGeneration(): number {
  return activeGeneration;
}

export async function writeStoredActiveWorkspaceId(id: string): Promise<void> {
  activeGeneration += 1;
  const file = filePath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ activeWorkspaceId: id }, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// ─── Storage mode: this machine's side of the activation gate (VERM-53) ─────
//
// userData/workspace-storage.json says whether this machine reads the legacy
// _vermilian-config article or the per-workspace articles, and which
// activation it joined. Only activation and the return to legacy storage
// (services/storageActivation.ts) write it; nothing writes it at startup or
// on install. A missing file is legacy. An unreadable one is legacy *and*
// corrupt, which blocks every configuration write until it is repaired.
//
// The e2e fake backend can still force per-workspace storage with
// VERMILIAN_E2E_WORKSPACE_STORAGE=per-workspace; it then also seeds an
// active marker with E2E_STORAGE_GENERATION (api/fakeYouTrack.ts).

export const E2E_STORAGE_GENERATION = 'e2e-generation-0001';

function storageFile(): string {
  return path.join(app.getPath('userData'), 'workspace-storage.json');
}

let storageCache: { state: LocalStorageState; corrupt: boolean } | null = null;

function e2eForcedStorage(): { state: LocalStorageState; corrupt: boolean } | null {
  if (!IS_E2E || process.env.VERMILIAN_E2E_WORKSPACE_STORAGE !== 'per-workspace') return null;
  return {
    state: { schema: LOCAL_STORAGE_STATE_SCHEMA, mode: 'per-workspace', generation: E2E_STORAGE_GENERATION, changedAt: null, backupFile: null },
    corrupt: false,
  };
}

/** This machine's storage state, read once and cached; writes update the cache. */
export function readLocalStorageState(): { state: LocalStorageState; corrupt: boolean } {
  const forced = e2eForcedStorage();
  if (forced) return forced;
  if (storageCache) return storageCache;
  let raw: string | null = null;
  let unreadable = false;
  try {
    raw = readFileSync(storageFile(), 'utf8');
  } catch (e) {
    unreadable = (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  storageCache = unreadable ? { state: LEGACY_LOCAL_STATE, corrupt: true } : parseLocalStorageState(raw);
  return storageCache;
}

/** Atomic and private (0600). Throws when it cannot be written. */
export async function writeLocalStorageState(state: LocalStorageState): Promise<void> {
  const file = storageFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, file);
  storageCache = { state, corrupt: false };
}

/** Which store workspaces are read from on this machine. */
export function workspaceStorageMode(): WorkspaceStorageMode {
  return readLocalStorageState().state.mode;
}

// ─── Activation backups (VERM-53) ────────────────────────────────────────────
// userData/storage-activation-backups/, directory 0700 and files 0600. A file
// is created exclusively ('wx') and never overwritten or pruned.

function backupDir(): string {
  return path.join(app.getPath('userData'), 'storage-activation-backups');
}

export async function writeActivationBackup(fileName: string, content: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) return null;
  try {
    await fs.mkdir(backupDir(), { recursive: true, mode: 0o700 });
    const file = path.join(backupDir(), fileName);
    await fs.writeFile(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return file;
  } catch {
    return null;
  }
}

export async function readActivationBackup(file: string): Promise<string | null> {
  if (path.dirname(file) !== backupDir()) return null;
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

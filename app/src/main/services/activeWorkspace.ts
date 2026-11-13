// Per-machine active workspace (VERM-46, ADR-0011 §2) and the activation gate
// for per-workspace configuration storage.
//
// The active workspace ID lives in userData/active-workspace.json — local to
// this machine, never written to the shared _vermilian-config article. It is a
// file of its own, not a field in app-config.json, so a Settings save carrying
// an older snapshot of AppConfig can never overwrite the choice.

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IS_E2E } from '../e2e';
import type { WorkspaceStorageMode } from '../../shared/activeWorkspace';

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

export async function writeStoredActiveWorkspaceId(id: string): Promise<void> {
  const file = filePath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ activeWorkspaceId: id }, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Which store workspaces are read from.
 *
 * The activation gate is OFF in VERM-46: `_vermilian-config` stays
 * authoritative on every real machine, and there is deliberately no setting,
 * file or IPC call that turns it on. Activation — migration, verification,
 * the concurrency guard and the credential switch — is VERM-53, which
 * replaces this function. Only the e2e fake backend can exercise the
 * per-workspace path, via VERMILIAN_E2E_WORKSPACE_STORAGE=per-workspace.
 */
export function workspaceStorageMode(): WorkspaceStorageMode {
  if (IS_E2E && process.env.VERMILIAN_E2E_WORKSPACE_STORAGE === 'per-workspace') return 'per-workspace';
  return 'legacy';
}

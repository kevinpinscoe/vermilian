// The Anthropic key for one AI operation, from the active workspace only
// (VERM-47; rules in shared/workspaceAi.ts). Main process only: the key is
// returned to the IPC handler that calls Claude with it and goes no further.
//
// Dependencies are passed in so the decision is unit-testable without
// Electron.

import type { AppConfig } from '../../shared/config';
import type { WorkspaceChoice, WorkspaceStorageMode } from '../../shared/activeWorkspace';
import { AI_NOT_SELECTED_MESSAGE, e2eFakeAnthropicKey, e2eFakeAnthropicKeyAllowed } from '../../shared/workspaceAi';
import { resolveWorkspaceCredential, type CredentialSourceIO } from './credentialResolver';

export const AI_WORKSPACE_CHANGED_MESSAGE =
  'The active workspace changed before this AI request ran, so nothing was sent. Try again.';
export const AI_LEGACY_NO_KEY_MESSAGE = 'No Claude API key configured.';

export interface WorkspaceAiKeyRequest {
  storage: WorkspaceStorageMode;
  /** The active workspace on this machine, '' when there is none. */
  activeId: string;
  choices: readonly WorkspaceChoice[];
  /** The workspace the renderer asked from; ignored when absent. */
  requestedWorkspaceId: unknown;
  cfg: AppConfig;
  io: CredentialSourceIO;
  /** The Settings key's own loader, used unchanged under legacy storage. */
  loadLegacyKey: (cfg: AppConfig) => Promise<string | null>;
  e2e: boolean;
}

export type WorkspaceAiKey = { ok: true; key: string } | { ok: false; error: string };

export async function resolveWorkspaceAiKey(req: WorkspaceAiKeyRequest): Promise<WorkspaceAiKey> {
  const { requestedWorkspaceId: asked } = req;
  if (typeof asked === 'string' && asked !== '' && asked !== req.activeId) {
    return { ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE };
  }
  if (req.storage === 'legacy') {
    // Before VERM-53 every workspace uses the Settings key, loaded exactly as
    // it always was.
    const key = await req.loadLegacyKey(req.cfg);
    return key ? { ok: true, key } : { ok: false, error: AI_LEGACY_NO_KEY_MESSAGE };
  }
  const ref = req.choices.find((c) => c.id === req.activeId)?.aiCredentialRef ?? null;
  if (ref === null) return { ok: false, error: AI_NOT_SELECTED_MESSAGE };
  const r = await resolveWorkspaceCredential({ workspaceId: req.activeId, credentialRef: ref }, req.cfg, req.io);
  if (r.ok) return { ok: true, key: r.value };
  // e2e: a reference with nothing configured gets a fictional key naming it.
  if (req.e2e && e2eFakeAnthropicKeyAllowed(ref, r.reason)) return { ok: true, key: e2eFakeAnthropicKey(ref) };
  return { ok: false, error: `AI is unavailable: ${r.message}` };
}

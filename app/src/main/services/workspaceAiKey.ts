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

// ─── One AI operation, revalidated immediately before Anthropic ──────────────
// Resolving a credential is asynchronous — a command may run, a file or an
// encrypted blob be read — and so is loading the issues a recommendation or
// stand-up is about. The user can switch workspaces during either. So the
// active workspace is checked twice: when the operation begins
// (resolveWorkspaceAiKey), and again by send(), synchronously, in the same
// tick that hands the key to the Anthropic request. The second check uses a
// counter that every active-workspace change bumps synchronously
// (services/activeWorkspace.ts), so there is no await between it and the
// request, and a switch away and back still counts as a switch.

export interface WorkspaceAiOperationRequest extends WorkspaceAiKeyRequest {
  /** The switch counter, read before anything about the operation was decided. */
  startGeneration: number;
  /** The switch counter now. */
  currentGeneration: () => number;
}

export type WorkspaceAiSend = <T>(request: (key: string) => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; error: string }>;

export type WorkspaceAiOperation =
  // workspaceId: the workspace the operation belongs to — whatever data the
  // request carries must come from this workspace and no other (VERM-48).
  | { ok: true; workspaceId: string; send: WorkspaceAiSend }
  | { ok: false; error: string };

/**
 * Begins one AI operation for the active workspace. On success, `send` makes
 * the single Anthropic request with the workspace's key — or, if the active
 * workspace has changed since the operation began, refuses without calling
 * it. Nothing is retried, and no other workspace's credential is used. The
 * key stays inside the returned closure.
 */
export async function beginWorkspaceAiOperation(req: WorkspaceAiOperationRequest): Promise<WorkspaceAiOperation> {
  const resolved = await resolveWorkspaceAiKey(req);
  if (!resolved.ok) return resolved;
  const { key } = resolved;
  const send: WorkspaceAiSend = async (request) => {
    // No await between this check and the request starting.
    if (req.currentGeneration() !== req.startGeneration) return { ok: false, error: AI_WORKSPACE_CHANGED_MESSAGE };
    return { ok: true, value: await request(key) };
  };
  return { ok: true, workspaceId: req.activeId, send };
}

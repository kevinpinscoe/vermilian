// Which Anthropic credential a workspace's AI features use (VERM-47,
// ADR-0011 §5, proposal R5.4 Q2/G1/G3).
//
// Every AI operation — AI task creation, Priority Desk recommendations and
// stand-up generation — uses the active workspace's own credential reference,
// `ai.credentialRef`, and nothing else:
//
//   legacy storage        every workspace uses `anthropic-1`, the Settings
//                         key, exactly as before; per-workspace references
//                         take effect only once VERM-53 activates the store.
//   per-workspace storage the workspace's own reference, resolved by the
//                         VERM-45 resolver (command → file → safeStorage,
//                         the first configured source only). None selected
//                         means AI is unavailable; a new workspace starts
//                         with none and is never given `anthropic-1`.
//
// There is no fallback: not to `anthropic-1`, not to another workspace's
// reference, and not to a lower source after the configured one fails.
// Only references cross IPC, never what they resolve to.
//
// Pure TypeScript: no Electron, no React.

import type { WorkspaceStorageMode } from './activeWorkspace';
import type { CredentialFailureReason } from './credentialRefs';
import { MIGRATED_ANTHROPIC_CREDENTIAL_REF } from './workspaceMigration';
import { isCredentialRef, type CredentialRef, type WorkspaceDocument } from './workspaceSchema';
import { WorkspaceSetupError } from './workspaceSetup';

export type AiAvailability =
  | { state: 'available'; credentialRef: CredentialRef; message: null }
  | { state: 'not-selected'; credentialRef: null; message: string }
  | { state: 'unavailable'; credentialRef: CredentialRef; message: string };

export const AI_NOT_SELECTED_MESSAGE =
  'AI is off for this workspace: no Anthropic credential is selected. Choose one in Manage workspaces.';

/** The reference a workspace's AI operations use; null when none is selected. */
export function aiCredentialRefOf(
  storage: WorkspaceStorageMode,
  doc: Pick<WorkspaceDocument, 'ai'> | null,
): CredentialRef | null {
  if (storage === 'legacy') return MIGRATED_ANTHROPIC_CREDENTIAL_REF;
  return doc?.ai.credentialRef ?? null;
}

/**
 * Whether AI can run for a workspace, from its reference and whether that
 * reference has a source configured on this machine. A configured source
 * can still fail when it runs; the operation then fails closed with the
 * resolver's message.
 */
export function aiAvailability(credentialRef: CredentialRef | null, configured: boolean): AiAvailability {
  if (credentialRef === null) return { state: 'not-selected', credentialRef: null, message: AI_NOT_SELECTED_MESSAGE };
  if (!configured) {
    return {
      state: 'unavailable',
      credentialRef,
      message: `AI is unavailable: credential ${credentialRef} has no source configured on this machine. Set it up in Settings → Credentials.`,
    };
  }
  return { state: 'available', credentialRef, message: null };
}

export type AiCredentialRefInput = { ok: true; credentialRef: CredentialRef | null } | { ok: false; message: string };

/**
 * A reference typed by the user. Empty means None. Anything else must be a
 * well-formed reference; the message never repeats the input, in case a key
 * was pasted by mistake.
 */
export function parseAiCredentialRefInput(raw: string): AiCredentialRefInput {
  const v = raw.trim();
  if (v === '') return { ok: true, credentialRef: null };
  if (isCredentialRef(v)) return { ok: true, credentialRef: v };
  return {
    ok: false,
    message: 'Enter a credential reference — lowercase letters, digits and single hyphens, such as anthropic-1 — not a key. Leave it empty for None.',
  };
}

/**
 * The workspace with its AI reference set, changed, or cleared (null).
 * Everything else — backend, Jira project settings, folders, boards,
 * dismissals and any unknown `ai` fields — is kept. Throws
 * WorkspaceSetupError for a malformed reference.
 */
export function withAiCredentialRef(doc: WorkspaceDocument, credentialRef: CredentialRef | null): WorkspaceDocument {
  if (credentialRef !== null && !isCredentialRef(credentialRef)) {
    throw new WorkspaceSetupError('That is not a well-formed credential reference.');
  }
  return { ...doc, ai: { ...doc.ai, credentialRef } };
}

// ─── e2e only ────────────────────────────────────────────────────────────────
// Under VERMILIAN_E2E, a reference with nothing configured resolves to a
// fictional key that names it, so the fake Claude can report which
// reference each call used. References beginning `e2e-missing` are left
// unconfigured on purpose, to exercise "selected but unavailable here".
// A configured source that fails is never replaced by the fake.

const E2E_KEY_PREFIX = 'e2e-anthropic-key:';

export function e2eFakeAnthropicKeyAllowed(credentialRef: CredentialRef, reason: CredentialFailureReason): boolean {
  return reason === 'no-source' && !credentialRef.startsWith('e2e-missing');
}

export function e2eFakeAnthropicKey(credentialRef: CredentialRef): string {
  return `${E2E_KEY_PREFIX}${credentialRef}`;
}

export function refFromE2eFakeAnthropicKey(key: string): CredentialRef | null {
  if (!key.startsWith(E2E_KEY_PREFIX)) return null;
  const ref = key.slice(E2E_KEY_PREFIX.length);
  return isCredentialRef(ref) ? ref : null;
}

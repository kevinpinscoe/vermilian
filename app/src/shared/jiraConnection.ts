// Why a Jira workspace's connection failed, and what reconnecting takes
// (VERM-40). A revoked or expired token, or a credential that no longer
// resolves on this host, puts the workspace's board in a reconnect state
// instead of a bare error line.
//
// Pure TypeScript: no Electron, no React.

import type { CredentialRefStatus } from './credentialRefs';

export type WorkspaceJiraFailureReason =
  | 'unauthorized' // Jira rejected the token: revoked, expired, or not this account's
  | 'credential' // the workspace's credential reference did not resolve on this host
  | 'error'; // anything else (network, a missing issue, a refused project, …)

export interface WorkspaceJiraFailure {
  ok: false;
  message: string;
  reason: WorkspaceJiraFailureReason;
  /** The workspace's credential reference, when known; never the credential. */
  credentialRef: string | null;
}

/** Jira answers 401 to a token it does not accept, at any endpoint. */
export function isJiraUnauthorized(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 401;
}

/** Whether a failure is one reconnecting fixes, rather than a retry or a different request. */
export function needsJiraReconnect(result: { ok: boolean; reason?: unknown } | null | undefined): boolean {
  return !!result && result.ok === false && (result.reason === 'unauthorized' || result.reason === 'credential');
}

export interface ReconnectAdvice {
  /** A token typed here would be the one resolution uses: no command or file source outranks it. */
  canEnterToken: boolean;
  text: string;
}

/**
 * What the user can do for this reference on this host. Resolution order is
 * command, then file, then the stored (encrypted) token, so a token typed
 * into the app only takes effect when neither of the first two is set.
 */
export function jiraReconnectAdvice(status: CredentialRefStatus | null, credentialRef: string | null): ReconnectAdvice {
  if (!credentialRef) {
    return { canEnterToken: false, text: 'This workspace names no credential reference. Edit the workspace to choose one.' };
  }
  if (status?.legacy) {
    return { canEnterToken: false, text: `"${credentialRef}" is the Jira token from Settings. Replace it there, then try again.` };
  }
  if (status?.commandConfigured) {
    return { canEnterToken: false, text: `"${credentialRef}" reads its token from a command on this host. Update what that command returns, then try again.` };
  }
  if (status?.fileConfigured) {
    return { canEnterToken: false, text: `"${credentialRef}" reads its token from a file on this host. Put the new token in that file, then try again.` };
  }
  return {
    canEnterToken: true,
    text: `Create a new Jira API token for this account and enter it here; it is stored encrypted on this host as "${credentialRef}".`,
  };
}

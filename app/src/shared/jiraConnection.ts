// Why a Jira workspace's connection failed, and what reconnecting takes
// (VERM-40). A revoked or expired token, or a credential that no longer
// resolves on this host, puts the workspace's board in a reconnect state
// instead of a bare error line.
//
// Pure TypeScript: no Electron, no React.

import type { CredentialFailureReason, CredentialRefStatus } from './credentialRefs';

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

/**
 * Whether the e2e harness may stand in its fake token after resolution
 * failed. Only when nothing at all is configured for the reference: a
 * configured command, file or stored token that fails stops resolution on a
 * real host, and must stop it under e2e too.
 */
export function e2eFakeJiraTokenAllowed(failure: { reason: CredentialFailureReason }): boolean {
  return failure.reason === 'no-source';
}

/** What is known about the reference's configuration on this host. */
export type CredentialStatusLookup =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; status: CredentialRefStatus };

export interface ReconnectAdvice {
  /**
   * A token typed here would be the one resolution uses. True only once the
   * reference's status is known and shows it is not legacy and has neither a
   * command nor a file source to outrank a stored token.
   */
  canEnterToken: boolean;
  /** The status could not be read; offer to check again. */
  statusUnavailable: boolean;
  text: string;
}

/**
 * What the user can do for this reference on this host. Resolution order is
 * command, then file, then the stored (encrypted) token. Until the
 * reference's configuration is established, nothing is offered beyond trying
 * again: an unknown reference might read from a command, a file or Settings.
 */
export function jiraReconnectAdvice(lookup: CredentialStatusLookup, credentialRef: string | null): ReconnectAdvice {
  const advice = (text: string, canEnterToken = false, statusUnavailable = false): ReconnectAdvice => ({ canEnterToken, statusUnavailable, text });
  if (!credentialRef) return advice('This workspace names no credential reference. Edit the workspace to choose one.');
  if (lookup.state === 'loading') return advice(`Checking how "${credentialRef}" reads its token on this host…`);
  if (lookup.state === 'error') {
    return advice(`Could not check how "${credentialRef}" reads its token on this host: ${lookup.message}`, false, true);
  }
  const { status } = lookup;
  if (status.credentialRef !== credentialRef) {
    return advice(`Could not check how "${credentialRef}" reads its token on this host.`, false, true);
  }
  if (status.legacy) return advice(`"${credentialRef}" is the Jira token from Settings. Replace it there, then try again.`);
  if (status.commandConfigured) {
    return advice(`"${credentialRef}" reads its token from a command on this host. Update what that command returns, then try again.`);
  }
  if (status.fileConfigured) {
    return advice(`"${credentialRef}" reads its token from a file on this host. Put the new token in that file, then try again.`);
  }
  return advice(
    `Create a new Jira API token for this account and enter it here; it is stored encrypted on this host as "${credentialRef}".`,
    true,
  );
}

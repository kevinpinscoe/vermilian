// e2e only (VERMILIAN_E2E): fictional stand-ins for a workspace's YouTrack
// credential (VERM-48), alongside VERM-47's Anthropic one in workspaceAi.ts.
// A reference with nothing configured resolves to a token that names it, so
// the fake YouTrack can report which reference each read used; references
// beginning `e2e-missing` stay unconfigured to exercise "not available here".
// A configured source that fails is never replaced by the stand-in.
//
// Pure TypeScript: no Electron, no React.

import type { CredentialFailureReason } from './credentialRefs';
import { isCredentialRef, type CredentialRef } from './workspaceSchema';

const YOUTRACK_PREFIX = 'e2e-youtrack-token:';

export function e2eFakeCredentialAllowed(credentialRef: CredentialRef, reason: CredentialFailureReason): boolean {
  return reason === 'no-source' && !credentialRef.startsWith('e2e-missing');
}

export function e2eFakeYouTrackToken(credentialRef: CredentialRef): string {
  return `${YOUTRACK_PREFIX}${credentialRef}`;
}

export function refFromE2eFakeYouTrackToken(token: string): CredentialRef | null {
  if (!token.startsWith(YOUTRACK_PREFIX)) return null;
  const ref = token.slice(YOUTRACK_PREFIX.length);
  return isCredentialRef(ref) ? ref : null;
}

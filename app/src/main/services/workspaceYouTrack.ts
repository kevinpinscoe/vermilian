// A workspace's own YouTrack connection under per-workspace storage (VERM-48):
// its `backend.serverUrl` and `backend.credentialRef`, the reference resolved
// by the VERM-45 resolver (command → file → safeStorage, the first configured
// source only). Main process only: the token goes to the caller that reads
// YouTrack with it and no further.
//
// There is no fallback — not to the Settings YouTrack token, not to another
// workspace's reference, not to a lower source after the configured one
// fails. A missing workspace, a Jira workspace, no reference, or a reference
// that does not resolve is refused with a message that names the reference
// at most, never a value, command or path.

import type { AppConfig } from '../../shared/config';
import type { WorkspaceDocument } from '../../shared/workspaceSchema';
import { e2eFakeCredentialAllowed, e2eFakeYouTrackToken } from '../../shared/e2eFakeCredentials';
import { resolveWorkspaceCredential, type CredentialSourceIO } from './credentialResolver';

export type WorkspaceYouTrackConnection = { ok: true; url: string; token: string } | { ok: false; error: string };

export const NO_WORKSPACE_MESSAGE = 'The active workspace could not be found, so nothing was read.';
export const JIRA_NO_YOUTRACK_MESSAGE = 'A Jira workspace has no YouTrack connection.';

export async function resolveWorkspaceYouTrackConnection(
  doc: WorkspaceDocument | null,
  cfg: AppConfig,
  io: CredentialSourceIO,
  e2e: boolean,
): Promise<WorkspaceYouTrackConnection> {
  if (!doc) return { ok: false, error: NO_WORKSPACE_MESSAGE };
  if (doc.backend.kind !== 'youtrack') return { ok: false, error: JIRA_NO_YOUTRACK_MESSAGE };
  const { serverUrl, credentialRef } = doc.backend;
  const r = await resolveWorkspaceCredential({ workspaceId: doc.workspaceId, credentialRef }, cfg, io);
  if (r.ok) return { ok: true, url: serverUrl, token: r.value };
  if (e2e && credentialRef !== null && e2eFakeCredentialAllowed(credentialRef, r.reason)) {
    return { ok: true, url: serverUrl, token: e2eFakeYouTrackToken(credentialRef) };
  }
  return { ok: false, error: `YouTrack is unavailable for this workspace: ${r.message}` };
}

// Workspace Runway order rows (VERM-75): the shapes that cross the IPC
// boundary for the runway_item store (main/services/runwayItemStore.ts,
// VERM-80/81) and the pure workspace/tracker rules its handlers apply
// (main/services/runwayItemIpc.ts, VERM-82). No Electron, no React.

import type { ActiveBackendContext } from './activeWorkspace';
import { decodeIssueId, type TrackerKind } from './tracker';

export type RunwayItemKind = 'issue' | 'section' | 'note';

export interface RunwayItem {
  workspaceId: string;
  /** Namespaced ticket ID (`yt:…`, `jira:…`), or `sec:`/`note:` + ID. */
  itemId: string;
  kind: RunwayItemKind;
  /** Stored row position, 1..N within the workspace, sections and notes included. */
  position: number;
  /** Runway #: 1..T counting ticket rows only; null for a section or note. */
  runwayNumber: number | null;
  depth: number;
  /** Section title or note body; null for a ticket. */
  text: string | null;
  /** ISO 8601. */
  addedAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * The tracker a workspace's Runway holds tickets from: the backend its
 * configuration names. A workspace with no backend setting — an existing
 * legacy (shared-storage) workspace from before workspaces had one — is
 * YouTrack.
 */
export function runwayWorkspaceTracker(workspace: { backend?: Pick<ActiveBackendContext, 'kind'> | null }): TrackerKind {
  return workspace.backend?.kind ?? 'youtrack';
}

/**
 * Why a ticket may not join this workspace's Runway, or null when it may.
 * Any project on the workspace's own tracker is allowed; a ticket from the
 * other tracker is 'wrong-tracker' (mixed-tracker Runways are not possible),
 * and an ID that is not a namespaced ticket ID is 'invalid-issue-id'.
 */
export function runwayTicketRefusal(
  workspaceTracker: TrackerKind,
  issueId: unknown,
): 'invalid-issue-id' | 'wrong-tracker' | null {
  const decoded = decodeIssueId(issueId);
  if (!decoded) return 'invalid-issue-id';
  return decoded.kind === workspaceTracker ? null : 'wrong-tracker';
}

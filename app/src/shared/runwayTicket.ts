// What a Runway ticket row reads as in its tracker (VERM-84): the shapes that
// cross the IPC boundary for runwayItemsResolve. No Electron, no React.
//
// Every ticket row on a workspace's Runway is read with that workspace's own
// connection only. The tracker's answer decides the row's state:
//
//   resolved               the ticket was read; `issue` holds its board data.
//   missing-or-unreadable  the tracker answered 404 for this ticket. YouTrack
//                          and Jira both answer 404 whether the ticket was
//                          deleted or this credential cannot see it, so the
//                          two cannot be told apart.
//   not-readable           an explicit refusal: the tracker answered 403 for
//                          this ticket, or (Jira) the ticket moved to a key
//                          this workspace may not read.
//   missing                the tracker confirmed the ticket is gone (410).
//
// Whatever the state, the Runway row and its number are kept: a read never
// writes runway_item, so a later refresh can restore the ticket's details.

import type { BoardIssue } from './workspace';

export type RunwayTicketState = 'resolved' | 'missing-or-unreadable' | 'not-readable' | 'missing';

export type RunwayTicketRead =
  | { itemId: string; state: 'resolved'; issue: BoardIssue }
  | { itemId: string; state: 'missing-or-unreadable' }
  | { itemId: string; state: 'not-readable'; reason?: string }
  | { itemId: string; state: 'missing' };

/**
 * Why a whole Runway read failed, with no per-ticket states:
 *   unauthorized    the tracker refused the workspace's connection (401).
 *   credential      the workspace's credential could not be resolved.
 *   refresh-failed  the tracker could not be reached, or answered with a
 *                   server error; nothing about any ticket is known.
 * plus the request refusals the Runway handlers share (invalid-args,
 * invalid-workspace, unknown-workspace, workspace-unavailable).
 */
export type RunwayTicketsErrorCode =
  | 'unauthorized'
  | 'credential'
  | 'refresh-failed'
  | 'invalid-args'
  | 'invalid-workspace'
  | 'unknown-workspace'
  | 'workspace-unavailable';

export type RunwayTicketsResult =
  | { ok: true; tickets: RunwayTicketRead[] }
  | { ok: false; error: string; code: RunwayTicketsErrorCode };

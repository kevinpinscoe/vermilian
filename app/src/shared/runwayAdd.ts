// Adding a ticket to the Runway by key or link (VERM-86): the shapes that
// cross the IPC boundary for runwayItemsAddByReference. No Electron, no React.

import type { RunwayItemsErrorCode } from './ipc';
import type { RunwayItem } from './runwayItem';
import type { RunwayReferenceRefusal } from './runwayReference';

export interface RunwayAddByReferenceArgs {
  workspaceId: string;
  /** What was typed or picked: a ticket key, or a ticket link on the workspace's own tracker. */
  reference: string;
  /** Add at this Runway #; absent means the end. */
  runwayNumber?: number;
}

export type RunwayAddErrorCode =
  | RunwayItemsErrorCode
  | RunwayReferenceRefusal
  /** The tracker answered 404: deleted, or this credential cannot see it. */
  | 'missing-or-unreadable'
  /** The tracker refused this ticket (403). */
  | 'not-readable'
  /** The tracker confirmed the ticket is gone (410). */
  | 'missing'
  /** The tracker refused the workspace's credential (401). */
  | 'unauthorized'
  /** The workspace's credential could not be resolved. */
  | 'credential'
  /** No answer, a timeout, a rate limit or a server error. `retryable` is set. */
  | 'refresh-failed'
  /** The active workspace changed while the ticket was being checked. */
  | 'cancelled';

export type RunwayAddResult =
  | { ok: true; items: RunwayItem[]; itemId: string }
  | { ok: false; code: RunwayAddErrorCode; error: string; retryable?: boolean };

/** The message for a 404 on the exact-key check (Kevin, 2026-11-22). */
export const RUNWAY_ADD_MISSING_MESSAGE = 'Ticket missing or not readable with this workspace’s credential.';

// Matching a Markdown schedule's tickets to a workspace (VERM-101): the shapes
// that cross the IPC boundary for runwayImportMatch. Pure — no Electron, no
// React. The rules live in main/services/runwayImportMatch.ts.
//
// The renderer parses the file (shared/runwaySchedule.ts) and sends, for each
// `##` group, the existing workspace the user chose to supply its connection
// and the group's candidate tickets as written. The main process validates
// every candidate again, reads it on that workspace's own connection only,
// and returns a result per candidate. Nothing is written: no Runway row, no
// workspace, no project. A proposed new workspace is matched through the
// workspace chosen for it; copying that connection at Apply is VERM-104.

import type { ScheduleGroup, ScheduleReferenceReason } from './runwaySchedule';
import type { RunwayDestinationRow, RunwaySavedIdentity } from './runwayImportAppend';

export type RunwayImportRole = 'scheduled' | 'reference';

export interface RunwayImportCandidate {
  /** The ticket as written in the file: a key or a link. */
  text: string;
  /** Its line in the file, 1-based. */
  line: number;
  role: RunwayImportRole;
  /** For a reference, why the parser did not schedule it; null for a scheduled ticket. */
  reason: ScheduleReferenceReason | null;
}

export interface RunwayImportGroupArgs {
  /** The renderer's own handle for the group, echoed back. */
  groupKey: string;
  /** The existing workspace whose connection the group is matched through. */
  workspaceId: string;
  candidates: RunwayImportCandidate[];
}

export interface RunwayImportMatchArgs {
  groups: RunwayImportGroupArgs[];
}

/** Why a candidate is unmatched: a reference refusal or a ticket read state. */
export type RunwayImportUnmatchedCode =
  | 'empty'
  | 'not-a-reference'
  | 'foreign-host'
  | 'not-a-ticket-url'
  | 'not-readable'
  | 'missing-or-unreadable'
  | 'missing';

export interface RunwayImportTicket {
  /** The namespaced ticket ID a Runway row would store (`yt:…`, `jira:…`). */
  issueId: string;
  /** The key the tracker answered with (a moved Jira issue answers with its new key). */
  key: string;
  summary: string;
  /**
   * Every tracker-qualified ID the ticket answered to on this connection: its
   * stored ID, the key asked for and, for YouTrack, its entity ID (VERM-105).
   * A repeat import matches saved rows by these.
   */
  aliases?: string[];
}

interface CandidateBase {
  text: string;
  line: number;
  role: RunwayImportRole;
  reason: ScheduleReferenceReason | null;
}

export type RunwayImportCandidateMatch =
  | (CandidateBase & { status: 'matched'; ticket: RunwayImportTicket })
  // A later scheduled occurrence of a ticket an earlier scheduled one already matched.
  | (CandidateBase & { status: 'duplicate'; ticket: RunwayImportTicket; duplicateOfLine: number })
  | (CandidateBase & { status: 'unmatched'; code: RunwayImportUnmatchedCode; message: string });

/**
 * One group's whole match failed and no candidate was classified:
 *   refresh-failed     the tracker did not answer, or answered with a server
 *                      error. `retryable` is true: Retry can be offered at once.
 *   unauthorized       the tracker refused the workspace's credential (401).
 *   credential         the workspace's credential could not be resolved.
 *   unknown-workspace  the chosen workspace is not configured.
 * The last three need something corrected first; `error` says what.
 */
export type RunwayImportGroupErrorCode = 'refresh-failed' | 'unauthorized' | 'credential' | 'unknown-workspace';

export type RunwayImportGroupMatch =
  | {
      groupKey: string;
      workspaceId: string;
      ok: true;
      candidates: RunwayImportCandidateMatch[];
      /**
       * The tracker connection the group was read on: its tracker, server or
       * site, email and credential reference (VERM-104). Apply requires the
       * same connection; absent when the matcher was given no way to tell.
       */
      connectionKey?: string;
    }
  | { groupKey: string; workspaceId: string; ok: false; code: RunwayImportGroupErrorCode; error: string; retryable: boolean };

export type RunwayImportMatchResult =
  | { ok: true; groups: RunwayImportGroupMatch[] }
  | { ok: false; code: 'invalid-args' | 'workspace-unavailable'; error: string };

/** Request bounds, checked in the main process. */
export const RUNWAY_IMPORT_MAX_GROUPS = 200;
export const RUNWAY_IMPORT_MAX_CANDIDATES = 5000;
export const RUNWAY_IMPORT_MAX_TEXT = 2048;

/**
 * A parsed group's candidates, in file order: every scheduled ticket and
 * every reference, each as written (its original link when it had one).
 *
 * A line the parser set aside as a duplicate was written as a scheduled
 * item, so it is sent as scheduled: the parser compares host and key only,
 * and the earlier link it deferred to may yet be refused (a path outside the
 * workspace's tracker). The matcher decides duplicates after validating each
 * link.
 */
export function scheduleCandidates(group: ScheduleGroup): RunwayImportCandidate[] {
  const scheduled = group.rows.flatMap((r): RunwayImportCandidate[] =>
    r.kind === 'ticket' ? [{ text: r.ticket.url ?? r.ticket.key, line: r.line, role: 'scheduled', reason: null }] : [],
  );
  const references = group.references.map(
    (r): RunwayImportCandidate =>
      r.reason === 'duplicate'
        ? { text: r.ticket.url ?? r.ticket.key, line: r.line, role: 'scheduled', reason: null }
        : { text: r.ticket.url ?? r.ticket.key, line: r.line, role: 'reference', reason: r.reason },
  );
  return [...scheduled, ...references].sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Choosing the Markdown file (VERM-102): runwayMarkdownOpen. The main process
// shows the native picker, reads the chosen file and returns its name and
// text. It writes nothing.

/** The largest schedule file accepted: exactly 1 MiB. */
export const RUNWAY_MARKDOWN_MAX_BYTES = 1024 * 1024;

/** The file types the picker offers. */
export const RUNWAY_MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'] as const;

export type RunwayMarkdownOpenErrorCode = 'too-large' | 'not-utf8' | 'read-failed';

export type RunwayMarkdownOpenResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; fileName: string; text: string }
  | { ok: false; code: RunwayMarkdownOpenErrorCode; error: string };

// ---------------------------------------------------------------------------
// Applying the preview (VERM-104): runwayMarkdownApply. The renderer sends the
// plan it shows; the main process verifies it, backs up the Runway database,
// creates the new workspaces and fills their (empty) Runways.

export type RunwayImportApplyRow =
  /** A numbered ticket: its stored ID and the text it was written as (key or link). */
  | { kind: 'ticket'; issueId: string; text: string; line: number }
  | { kind: 'section'; text: string; depth: number; line: number }
  | { kind: 'note'; text: string; depth: number; line: number };

export type RunwayImportApplyTarget =
  | { kind: 'existing'; workspaceId: string }
  /** A new workspace copying `connectionWorkspaceId`'s tracker connection and credential reference. */
  | { kind: 'new'; name: string; connectionWorkspaceId: string };

export interface RunwayImportApplyGroup {
  groupKey: string;
  target: RunwayImportApplyTarget;
  /** The connection the preview checked the group on (the match's connectionKey). */
  connectionKey: string;
  /** Every row the file gives the group, in preview order. */
  rows: RunwayImportApplyRow[];
  /**
   * An existing destination only (VERM-105): its rows as the preview compared
   * them, and which of `rows` the preview showed being appended (indices, in
   * order). Apply refuses when either differs from what it finds.
   */
  destination?: { rows: RunwayDestinationRow[]; append: number[] };
}

export interface RunwayImportApplyArgs {
  groups: RunwayImportApplyGroup[];
}

/** The saved tickets of a destination Runway, read on its own connection (VERM-105). */
export interface RunwayImportIdentifyArgs {
  workspaceId: string;
  itemIds: string[];
}

export type RunwayImportIdentifyResult =
  | { ok: true; connectionKey: string; items: RunwaySavedIdentity[] }
  | { ok: false; code: 'invalid-args' | RunwayImportGroupErrorCode; error: string; retryable: boolean };

/**
 * Why a group goes back to the preview. Nothing was written.
 *   tickets-changed     a numbered ticket no longer reads as the same ticket
 *                       on the group's connection: check it again and review
 *   check-failed        the tickets could not be read to verify them
 *   connection-missing  the workspace supplying the connection is gone
 *   connection-changed  that workspace's tracker connection (site, server,
 *                       email or credential reference) is not the one the
 *                       preview checked: check again and review
 *   workspace-missing   the existing destination workspace is gone
 *   name-taken          a new workspace's name is already used
 *   same-destination    two groups go to one existing workspace: merge or skip
 *   runway-changed      the destination's Runway changed since the preview
 *                       (a row added, removed, moved or edited): preview again
 *   unable-to-verify    a ticket already on the Runway could not be read, so a
 *                       new ticket might be the same one
 *   append-changed      the rows to append are not the ones the preview showed
 */
export type RunwayImportApplyReason =
  | 'tickets-changed'
  | 'check-failed'
  | 'connection-missing'
  | 'connection-changed'
  | 'workspace-missing'
  | 'name-taken'
  | 'same-destination'
  | 'runway-changed'
  | 'unable-to-verify'
  | 'append-changed';

export interface RunwayImportApplyProblem {
  groupKey: string;
  reason: RunwayImportApplyReason;
  message: string;
}

export interface RunwayImportAppliedWorkspace {
  groupKey: string;
  workspaceId: string;
  name: string;
  created: boolean;
  rows: number;
}

export type RunwayImportApplyErrorCode =
  | 'invalid-args'
  | 'workspace-unavailable'
  | 'nothing-new' // every group would add nothing; nothing was backed up or written
  | 'review' // groups need correcting; nothing was written
  | 'backup-failed' // the backup could not be written; nothing was changed
  | 'create-failed' // a workspace could not be created; no rows were written
  | 'write-failed'; // the rows could not be written; none were

export type RunwayImportApplyResult =
  | { ok: true; workspaces: RunwayImportAppliedWorkspace[]; backupPath: string }
  | {
      ok: false;
      code: RunwayImportApplyErrorCode;
      error: string;
      problems: RunwayImportApplyProblem[];
      /** The pre-Apply backup, when one was written. */
      backupPath: string | null;
      /** Workspaces this Apply created that it could not confirm removed, with any article left under their title for inspection. */
      remaining: RunwayImportApplyRemaining[];
    };

/**
 * A workspace an Apply created whose cleanup it could not confirm: its ID and
 * name; the articles this import created that may still be there
 * (articleIds, to remove by hand); and articles under its title this import
 * did not create, or cannot confirm creating, which were deliberately left in
 * place (inspectArticleIds, to inspect, never to remove blindly).
 */
export interface RunwayImportApplyRemaining {
  workspaceId: string;
  name: string;
  articleIds: string[];
  inspectArticleIds: string[];
}

/** The recovery message for one remaining workspace, as the dialog shows it. */
export function applyRecoveryLines(r: RunwayImportApplyRemaining): { workspace: string; remove: string | null; inspect: string | null } {
  const ids = (list: string[]) => `article ${list.join(', ')}`;
  return {
    workspace: `${r.name} (${r.workspaceId})`,
    remove:
      r.articleIds.length > 0
        ? `Created by this import and not confirmed removed; remove by hand: ${ids(r.articleIds)}`
        : r.inspectArticleIds.length === 0
          ? 'Created by this import and not confirmed removed; remove it by hand.'
          : null,
    inspect: r.inspectArticleIds.length > 0 ? `Left in place for inspection: ${ids(r.inspectArticleIds)}` : null,
  };
}

export const RUNWAY_IMPORT_MAX_APPLY_ROWS = 20000;

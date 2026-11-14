// Tracker kinds and provider-namespaced issue IDs (ADR-0011).
//
// A workspace has exactly one backend, but identifiers stored outside a
// backend (Runway metadata, dismissals, focus ranks) must never be mistaken
// for one from the other backend. Every such identifier is therefore stored as
// `<prefix>:<local id>`:
//
//   yt:DEMO-123     a YouTrack issue (readable ID)
//   yt:2-45         a YouTrack issue (internal entity ID)
//   jira:DEMO-123   a Jira issue key
//
// Pure TypeScript: no Electron, no React. Safe in either process and in tests.

import type { BoardIssue, IssueDetail } from './workspace';

export const TRACKER_KINDS = ['youtrack', 'jira'] as const;

export type TrackerKind = (typeof TRACKER_KINDS)[number];

export const TRACKER_ID_PREFIX: Readonly<Record<TrackerKind, string>> = {
  youtrack: 'yt',
  jira: 'jira',
};

// A string known to be a well-formed namespaced issue ID. The brand stops a
// bare local ID being passed where a namespaced one is required.
export type NamespacedIssueId = string & { readonly __namespacedIssueId: unique symbol };

export interface DecodedIssueId {
  kind: TrackerKind;
  localId: string;
}

// YouTrack readable IDs are `<PROJECT>-<number>`; project short names may mix
// case and contain digits and underscores. Internal entity IDs are
// `<type>-<number>`.
const YOUTRACK_READABLE_RE = /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/;
const YOUTRACK_ENTITY_RE = /^[0-9]+-[0-9]+$/;

// Jira issue keys are `<PROJECT>-<number>`: the project key starts with an
// uppercase letter, followed by uppercase letters, digits or underscores; the
// number has no leading zero.
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

export function isTrackerKind(value: unknown): value is TrackerKind {
  return typeof value === 'string' && (TRACKER_KINDS as readonly string[]).includes(value);
}

export function isValidLocalId(kind: TrackerKind, localId: string): boolean {
  switch (kind) {
    case 'youtrack':
      return YOUTRACK_READABLE_RE.test(localId) || YOUTRACK_ENTITY_RE.test(localId);
    case 'jira':
      return JIRA_KEY_RE.test(localId);
  }
}

// Throws on an unknown kind or a local ID that is not valid for it, so a
// malformed identifier can never be written anywhere.
export function encodeIssueId(kind: TrackerKind, localId: string): NamespacedIssueId {
  if (!isTrackerKind(kind)) {
    throw new Error(`Unknown tracker kind: ${String(kind)}`);
  }
  if (typeof localId !== 'string' || !isValidLocalId(kind, localId)) {
    throw new Error(`Invalid ${kind} issue ID: ${JSON.stringify(localId)}`);
  }
  return `${TRACKER_ID_PREFIX[kind]}:${localId}` as NamespacedIssueId;
}

// Returns null for anything that is not a well-formed namespaced ID: no
// prefix, an unknown prefix, or a local ID invalid for its tracker. A bare
// (un-namespaced) ID is rejected rather than guessed at.
export function decodeIssueId(id: unknown): DecodedIssueId | null {
  if (typeof id !== 'string') return null;
  const sep = id.indexOf(':');
  if (sep <= 0) return null;
  const prefix = id.slice(0, sep);
  const localId = id.slice(sep + 1);
  const kind = TRACKER_KINDS.find((k) => TRACKER_ID_PREFIX[k] === prefix);
  if (!kind || !isValidLocalId(kind, localId)) return null;
  return { kind, localId };
}

export function isNamespacedIssueId(id: unknown): id is NamespacedIssueId {
  return decodeIssueId(id) !== null;
}

// Like decodeIssueId, but throws with the offending value for callers that
// treat a malformed stored ID as corruption.
export function parseIssueId(id: unknown): DecodedIssueId {
  const decoded = decodeIssueId(id);
  if (!decoded) {
    throw new Error(`Malformed namespaced issue ID: ${JSON.stringify(id)}`);
  }
  return decoded;
}

export function trackerKindOf(id: NamespacedIssueId): TrackerKind {
  return parseIssueId(id).kind;
}

// ── Tracker providers (VERM-27, ADR-0011) ─────────────────────────────────────
//
// A provider is one backend connection — a tracker client bound to its server
// URL and credential — behind a backend-neutral surface. Main-process code asks
// a provider for projects and issues instead of calling a client directly, so a
// second backend (Jira, VERM-28) can stand behind the same calls.
//
// Issue IDs passed to and returned by a provider are the backend's own local
// IDs (`DEMO-12`, `2-45`), never namespaced: a provider only ever sees its own
// backend's issues. Namespacing applies to identifiers stored outside a
// backend, above.

/** A project as every backend can describe it. */
export interface TrackerProject {
  id: string;
  name: string;
  shortName: string;
}

/** Read operations every backend provides. */
export interface TrackerProvider {
  readonly kind: TrackerKind;
  /** Display name of the account the credential authenticates as. */
  getCurrentUser(): Promise<string>;
  getProjects(): Promise<TrackerProject[]>;
  getIssues(projectShortName: string, includeResolved?: boolean): Promise<BoardIssue[]>;
  searchIssues(projectShortNames: string[], query: string): Promise<BoardIssue[]>;
  getIssueDetail(issueId: string): Promise<IssueDetail>;
}

/**
 * Write operations, for backends Vermilian may change. A read-only backend
 * (Jira in Phase 1) implements TrackerProvider alone, so a write can only be
 * reached through isWritableTracker().
 */
export interface WritableTrackerProvider extends TrackerProvider {
  patchIssue(issueId: string, field: string, value: string | number | null): Promise<void>;
  postComment(issueId: string, text: string): Promise<void>;
  moveIssue(issueId: string, targetProjectId: string): Promise<void>;
  deleteIssue(issueId: string): Promise<void>;
  postWorklog(issueId: string, minutes: number, worklogType: string): Promise<void>;
}

const WRITE_METHODS = ['patchIssue', 'postComment', 'moveIssue', 'deleteIssue', 'postWorklog'] as const;

export function isWritableTracker(p: TrackerProvider): p is WritableTrackerProvider {
  const candidate = p as Partial<Record<(typeof WRITE_METHODS)[number], unknown>>;
  return WRITE_METHODS.every((m) => typeof candidate[m] === 'function');
}

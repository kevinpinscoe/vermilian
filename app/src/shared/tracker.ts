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

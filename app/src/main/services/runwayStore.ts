// Provider-neutral Runway metadata store (ADR-0011 §6).
//
// One interface, two implementations, chosen by the issue ID's provider
// prefix (shared/tracker.ts):
//
//   yt:<id>     YouTrack. Reads and writes the issue's existing Focus,
//               Focus rank and Why now custom fields exactly as before
//               (ADR-0007). Nothing is migrated; the workspace ID is not
//               part of the key because the fields live on the issue.
//   jira:<KEY>  Jira. Reads and writes the local SQLite database
//               (runwayDb.ts), keyed by workspace ID + issue ID. Nothing is
//               ever written to Jira.
//
// No Electron import: callers inject the YouTrack read/patch functions and
// the open database, so both implementations are unit-testable.

import type { DatabaseSync } from 'node:sqlite';
import { parseIssueId, type NamespacedIssueId, type TrackerKind } from '../../shared/tracker';
import {
  EMPTY_RUNWAY_METADATA,
  applyRunwayPatch,
  isEmptyRunwayMetadata,
  isRunwayRank,
  planYouTrackWrites,
  type RunwayEntry,
  type RunwayMetadata,
  type RunwayPatch,
} from '../../shared/runway';

export type RunwayStoreErrorCode =
  | 'rank-taken' // another issue in the workspace already holds that rank
  | 'wrong-provider' // the issue ID belongs to the other store
  | 'invalid-patch';

export class RunwayStoreError extends Error {
  constructor(
    readonly code: RunwayStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunwayStoreError';
  }
}

export interface RunwayMetadataStore {
  readonly kind: TrackerKind;
  /** The issue's metadata; an issue with none returns the empty state. */
  get(workspaceId: string, issueId: NamespacedIssueId): Promise<RunwayEntry>;
  /** Applies `patch` (ADR-0007 rules) and returns the stored result. */
  update(workspaceId: string, issueId: NamespacedIssueId, patch: RunwayPatch): Promise<RunwayEntry>;
}

function localIdFor(kind: TrackerKind, issueId: NamespacedIssueId): string {
  const decoded = parseIssueId(issueId);
  if (decoded.kind !== kind) {
    throw new RunwayStoreError('wrong-provider', `${issueId} is not a ${kind} issue`);
  }
  return decoded.localId;
}

function nextOrInvalid(current: RunwayMetadata, patch: RunwayPatch): RunwayMetadata {
  try {
    return applyRunwayPatch(current, patch);
  } catch (err) {
    throw new RunwayStoreError('invalid-patch', (err as Error).message);
  }
}

// ─── YouTrack: existing custom fields ───────────────────────────────────────

/** The three Focus fields as `BoardIssue.fields` carries them. */
export interface YouTrackFocusFields {
  focus?: string | null;
  focusRank?: number | null;
  whyNow?: string | null;
}

export interface YouTrackRunwayDeps {
  /** Reads the issue's current fields (getIssueDetail). */
  readFields(issueId: string): Promise<YouTrackFocusFields>;
  /** Writes one custom field (patchIssue). */
  patch(issueId: string, field: string, value: string | number | null): Promise<void>;
}

export function fromYouTrackFields(f: YouTrackFocusFields): RunwayMetadata {
  return {
    focus: f.focus === 'Yes',
    focusRank: isRunwayRank(f.focusRank) ? f.focusRank : null,
    whyNow: f.whyNow ? f.whyNow : null,
  };
}

export function createYouTrackRunwayStore(deps: YouTrackRunwayDeps): RunwayMetadataStore {
  return {
    kind: 'youtrack',
    async get(_workspaceId, issueId) {
      const localId = localIdFor('youtrack', issueId);
      return { issueId, ...fromYouTrackFields(await deps.readFields(localId)) };
    },
    async update(_workspaceId, issueId, patch) {
      const localId = localIdFor('youtrack', issueId);
      const current = fromYouTrackFields(await deps.readFields(localId));
      const next = nextOrInvalid(current, patch);
      // Sequential, in planYouTrackWrites' safe order; a failure stops the rest.
      for (const w of planYouTrackWrites(current, next)) {
        await deps.patch(localId, w.field, w.value);
      }
      return { issueId, ...next };
    },
  };
}

// ─── Jira: local SQLite ─────────────────────────────────────────────────────

interface RunwayRow {
  focus: number;
  focus_rank: number | null;
  why_now: string | null;
  deferred: number;
}

function fromRow(row: RunwayRow | undefined): RunwayMetadata {
  if (!row) return { ...EMPTY_RUNWAY_METADATA };
  return {
    focus: row.focus === 1,
    focusRank: isRunwayRank(row.focus_rank) ? row.focus_rank : null,
    whyNow: row.why_now,
  };
}

export function createJiraRunwayStore(
  db: DatabaseSync,
  now: () => Date = () => new Date(),
): RunwayMetadataStore {
  const select = db.prepare(
    `SELECT focus, focus_rank, why_now, deferred FROM runway_entry
     WHERE workspace_id = ? AND issue_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO runway_entry (workspace_id, issue_id, focus, focus_rank, why_now, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, issue_id) DO UPDATE SET
       focus = excluded.focus,
       focus_rank = excluded.focus_rank,
       why_now = excluded.why_now,
       updated_at = excluded.updated_at`,
  );
  const remove = db.prepare(`DELETE FROM runway_entry WHERE workspace_id = ? AND issue_id = ?`);

  return {
    kind: 'jira',
    async get(workspaceId, issueId) {
      localIdFor('jira', issueId);
      return { issueId, ...fromRow(select.get(workspaceId, issueId) as RunwayRow | undefined) };
    },
    async update(workspaceId, issueId, patch) {
      localIdFor('jira', issueId);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = select.get(workspaceId, issueId) as RunwayRow | undefined;
        const next = nextOrInvalid(fromRow(row), patch);
        if (isEmptyRunwayMetadata(next) && (row?.deferred ?? 0) === 0) {
          // Nothing left to remember: keep the database to real entries only.
          remove.run(workspaceId, issueId);
        } else {
          upsert.run(
            workspaceId,
            issueId,
            next.focus ? 1 : 0,
            next.focusRank,
            next.whyNow,
            now().toISOString(),
          );
        }
        db.exec('COMMIT');
        return { issueId, ...next };
      } catch (err) {
        db.exec('ROLLBACK');
        if (err instanceof Error && /UNIQUE constraint failed: runway_entry\.workspace_id, runway_entry\.focus_rank/.test(err.message)) {
          throw new RunwayStoreError(
            'rank-taken',
            `Focus rank ${String(patch.focusRank)} is already held by another issue in this workspace`,
          );
        }
        throw err;
      }
    },
  };
}

// ─── Routing ────────────────────────────────────────────────────────────────

export interface RunwayStores {
  youtrack: RunwayMetadataStore;
  jira: RunwayMetadataStore;
}

/** The store for `issueId`'s provider. Throws on a malformed or bare ID. */
export function storeForIssue(stores: RunwayStores, issueId: string): RunwayMetadataStore {
  return stores[parseIssueId(issueId).kind];
}

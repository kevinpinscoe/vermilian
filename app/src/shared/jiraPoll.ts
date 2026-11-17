// Keeping a Jira board fresh without webhooks (VERM-39).
//
// A Jira API token cannot register webhooks, so the board polls. Two reads
// keep a project's cached issues current, both read-only:
//
//   incremental  every JIRA_POLL_INTERVAL_MS, the project's issues updated in
//                the last JIRA_POLL_WINDOW_MINUTES (`updated >= -5m`), merged
//                into the cache by mergeRecentlyUpdated.
//   full         every JIRA_FULL_REFRESH_MS, and whenever the incremental
//                chain is broken (needsFullRefresh), the project's whole issue
//                set, reconciled into the cache by reconcileFullRefresh.
//
// The full read is not optional. An incremental query only ever returns
// issues that still match it, so it cannot see an issue that was deleted, or
// moved to a project the workspace does not poll; only a full read replaces
// the issue set and makes such a card disappear. Its cadence is a trade-off:
// a full read pages through the whole project (up to ten requests) where an
// incremental read is usually one small page, so it runs every ten polls. A
// card for a deleted or moved-away issue can therefore linger up to ten
// minutes; every other change shows within a minute.
//
// Neither read ever lets an older copy of an issue replace a newer one: the
// detail panel reads an issue directly by key, which Jira answers from the
// issue itself, while search answers from an index that can lag it. For the
// same reason a full read does not remove an issue read directly within
// JIRA_DIRECT_READ_GRACE_MS just because the search omits it; after that,
// it is removed like any other.
//
// Pure TypeScript: no Electron, no React.

import type { BoardIssue } from './workspace';
import { jiraProjectKeyOf } from './jiraBoardIssue';

/** How often the incremental poll runs while the window is visible. */
export const JIRA_POLL_INTERVAL_MS = 60_000;
/** How far back the incremental poll looks: JQL `updated >= -5m`. */
export const JIRA_POLL_WINDOW_MINUTES = 5;
export const JIRA_POLL_WINDOW_MS = JIRA_POLL_WINDOW_MINUTES * 60_000;
/** How often the full, authoritative read runs even when polling is healthy. */
export const JIRA_FULL_REFRESH_MS = 10 * 60_000;
/**
 * How long an issue read directly (the detail panel) survives full reads
 * that do not list it. Jira's search index can trail the issue itself, so a
 * full read just after a direct read may not list an issue that exists yet.
 * Jira normally catches up within seconds; five minutes bounds the wait
 * while staying shorter than the full-refresh cadence, so a card for an
 * issue that is really gone outlives its last direct read by at most one
 * full-refresh cycle past the grace period.
 */
export const JIRA_DIRECT_READ_GRACE_MS = 5 * 60_000;
/**
 * The longest gap since the last successful sync *started* that an
 * incremental poll may still bridge. One poll interval short of the window,
 * as margin for request latency and for clock skew between this machine and
 * Jira, which evaluates `-5m` against its own clock.
 */
export const JIRA_POLL_GAP_LIMIT_MS = JIRA_POLL_WINDOW_MS - JIRA_POLL_INTERVAL_MS;

/** An issue's last-updated time, or null when it is missing or not a usable epoch ms. */
export function validUpdated(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export type UpdatedOrder = 'newer' | 'older' | 'equal' | 'unknown';

/**
 * How `incoming` compares with `existing` by last-updated time. 'unknown'
 * whenever either timestamp is missing or invalid: a missing timestamp says
 * nothing about age, so it is never read as "older".
 */
export function compareUpdated(incoming: BoardIssue, existing: BoardIssue): UpdatedOrder {
  const a = validUpdated(incoming.updated);
  const b = validUpdated(existing.updated);
  if (a === null || b === null) return 'unknown';
  return a > b ? 'newer' : a < b ? 'older' : 'equal';
}

/**
 * Which cached issue list a merge writes: one project's board query, or one
 * Jira board's (VERM-59). A project list decides membership by the issue's
 * key; a board list cannot — its saved filter lives in Jira — so it treats
 * every issue as a member and only ever gains issues from its own board's
 * reads (`addNew`, mergeRecentlyUpdated). Its full read settles the rest.
 */
export interface JiraMergeScope {
  projectKey?: string;
  boardId?: number;
  includeResolved: boolean;
}

function inScope(issue: BoardIssue, scope: JiraMergeScope): boolean {
  if (scope.boardId === undefined && jiraProjectKeyOf(issue.idReadable) !== scope.projectKey) return false;
  return scope.includeResolved || issue.resolved === null;
}

// The copy to keep of one issue. An incoming copy wins unless it is known to
// be older: on equal timestamps it is the same version, and when either is
// missing neither can be shown older, so the latest observation stands.
function winner(incoming: BoardIssue, existing: BoardIssue | undefined): BoardIssue {
  if (!existing) return incoming;
  return compareUpdated(incoming, existing) === 'older' ? existing : incoming;
}

/**
 * Merges recently updated issues — an incremental poll's result, or one
 * issue read directly — into one project's cached list. Issues match by
 * their stable Jira id, never by key, which changes when an issue moves.
 *
 * - A known-older copy never replaces, resolves or removes a newer one.
 * - A winning copy that is resolved (Show done off) or now in another
 *   project removes the card; one in scope replaces it in place.
 * - Issues not yet cached are added, newest first, ahead of the rest —
 *   unless `addNew` is false: a board list (VERM-59) takes new issues only
 *   from its own board's reads, since an update from elsewhere may not be
 *   on that board at all.
 *
 * Returns `current` itself when nothing changed; never mutates its input.
 */
export function mergeRecentlyUpdated(
  current: readonly BoardIssue[],
  updates: readonly BoardIssue[],
  scope: JiraMergeScope,
  addNew = true,
): BoardIssue[] {
  let list = current as BoardIssue[];
  const added: BoardIssue[] = [];
  for (const update of updates) {
    const at = list.findIndex((i) => i.id === update.id);
    const addedAt = added.findIndex((i) => i.id === update.id);
    const existing = at >= 0 ? list[at] : addedAt >= 0 ? added[addedAt] : undefined;
    const keep = winner(update, existing);
    if (keep === existing) continue;
    const stays = inScope(keep, scope);
    if (at >= 0) {
      list = stays ? list.map((i, n) => (n === at ? keep : i)) : list.filter((_, n) => n !== at);
    } else if (addedAt >= 0) {
      if (stays) added[addedAt] = keep;
      else added.splice(addedAt, 1);
    } else if (stays && addNew) {
      added.push(keep);
    }
  }
  if (added.length === 0) return list;
  const newestFirst = [...added].sort((a, b) => (validUpdated(b.updated) ?? 0) - (validUpdated(a.updated) ?? 0));
  return [...newestFirst, ...list];
}

/**
 * Reconciles a full read of one project into its cached list. The full
 * result decides which issues exist — a cached issue it no longer lists
 * (deleted, moved out, resolved with Show done off) disappears — but, as in
 * mergeRecentlyUpdated, a newer cached copy (from a direct read) is kept over
 * an older copy from the search, and dropped if that newer copy is out of
 * scope. The order is the full result's.
 *
 * One exception to "disappears": a cached issue in `protectedIds` — read
 * directly within JIRA_DIRECT_READ_GRACE_MS, which the caller tracks — is
 * kept, after the listed issues, when the full result omits it, because the
 * search index may simply not have caught up yet. It is kept only while its
 * cached copy is still in scope: a direct read that showed it resolved or
 * moved away has already taken it out of this list.
 */
export function reconcileFullRefresh(
  current: readonly BoardIssue[] | undefined,
  full: readonly BoardIssue[],
  scope: JiraMergeScope,
  protectedIds: ReadonlySet<string> = new Set(),
): BoardIssue[] {
  const byId = new Map((current ?? []).map((i) => [i.id, i]));
  const out: BoardIssue[] = [];
  const seen = new Set<string>();
  for (const issue of full) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    const keep = winner(issue, byId.get(issue.id));
    if (inScope(keep, scope)) out.push(keep);
  }
  for (const cached of current ?? []) {
    if (!seen.has(cached.id) && protectedIds.has(cached.id) && inScope(cached, scope)) out.push(cached);
  }
  return out;
}

/**
 * Whether the next sync must be a full read rather than an incremental one:
 * there is no earlier sync, the last one started longer ago than the gap
 * limit (the machine slept, was offline, or the window was hidden), or the
 * clock went backwards, after which the lookback window cannot be trusted.
 */
export function needsFullRefresh(now: number, lastSyncStartedAt: number | null): boolean {
  if (lastSyncStartedAt === null) return true;
  const gap = now - lastSyncStartedAt;
  return gap < 0 || gap > JIRA_POLL_GAP_LIMIT_MS;
}

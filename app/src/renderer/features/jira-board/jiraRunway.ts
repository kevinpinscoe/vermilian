// Jira Runway metadata in the renderer (VERM-38, ADR-0011 §6): a Jira
// issue's Focus star, Focus rank and Why now, read and written through the
// provider-neutral Runway store (VERM-37). For a jira: issue that store is
// the local SQLite database in userData, keyed by workspace ID + namespaced
// issue ID. Nothing here talks to Jira, and Jira's own Rank field is never
// read or written: it is one global order shared by every board and user.
//
// The pure helpers are unit-tested in jiraRunway.test.ts; the hooks wrap
// them. One React Query cache entry per workspace holds every entry, so the
// cards, the detail panel and the desk all read the same list.
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { encodeIssueId, type NamespacedIssueId } from '../../../shared/tracker';
import { EMPTY_RUNWAY_METADATA, type RunwayEntry, type RunwayPatch, type RunwayRank } from '../../../shared/runway';
import { useToastStore } from '../../stores/toast';

export const jiraRunwayQueryKey = (workspaceId: string) => ['workspace', 'jira-runway', workspaceId] as const;

/** The namespaced Runway ID of a Jira issue key (DEMO-101 → jira:DEMO-101). */
export function jiraRunwayId(issueKey: string): NamespacedIssueId {
  return encodeIssueId('jira', issueKey);
}

/** The Jira issue key of a jira: Runway ID, or null for any other ID. */
export function jiraKeyOf(issueId: string): string | null {
  return issueId.startsWith('jira:') ? issueId.slice('jira:'.length) : null;
}

// ─── Pure logic ─────────────────────────────────────────────────────────────

export interface JiraRunwayIndex {
  /** Entry by Jira issue key. A key with no entry has the empty state. */
  byKey: ReadonlyMap<string, RunwayEntry>;
  /** The issue key holding each rank. SQLite allows at most one per rank. */
  byRank: ReadonlyMap<RunwayRank, string>;
}

export function indexJiraRunway(entries: readonly RunwayEntry[]): JiraRunwayIndex {
  const byKey = new Map<string, RunwayEntry>();
  const byRank = new Map<RunwayRank, string>();
  for (const entry of entries) {
    const key = jiraKeyOf(entry.issueId);
    if (!key) continue;
    byKey.set(key, entry);
    if (entry.focusRank !== null) byRank.set(entry.focusRank, key);
  }
  return { byKey, byRank };
}

export function runwayEntryFor(index: JiraRunwayIndex, issueKey: string): RunwayEntry {
  return index.byKey.get(issueKey) ?? { issueId: jiraRunwayId(issueKey), ...EMPTY_RUNWAY_METADATA };
}

export type JiraRankDecision =
  | { kind: 'unchanged' } // the issue already holds that rank
  | { kind: 'direct' } // the rank is free
  | { kind: 'confirm'; holderKey: string }; // another issue holds it: ask before moving it

/**
 * What giving `issueKey` Focus rank `rank` involves. The database refuses a
 * second holder of a rank, so the choice is never the YouTrack repair state:
 * either the rank is free, or exactly one other issue holds it and Kevin
 * confirms moving it (that issue keeps its star, as on YouTrack).
 */
export function decideJiraRank(index: JiraRunwayIndex, rank: RunwayRank, issueKey: string): JiraRankDecision {
  const holder = index.byRank.get(rank);
  if (holder === undefined) return { kind: 'direct' };
  if (holder === issueKey) return { kind: 'unchanged' };
  return { kind: 'confirm', holderKey: holder };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

async function listEntries(workspaceId: string): Promise<RunwayEntry[]> {
  const result = await window.vermilian.runwayList({ workspaceId });
  if (!result.ok) throw new Error(result.error);
  return result.entries;
}

export function useJiraRunway(workspaceId: string) {
  const query = useQuery({
    queryKey: jiraRunwayQueryKey(workspaceId),
    queryFn: () => listEntries(workspaceId),
    // Local and only ever changed through this app: no refetch timer.
    staleTime: Infinity,
  });
  const index = indexJiraRunway(query.data ?? []);
  return { index, isLoading: query.isLoading, isError: query.isError, error: query.error as Error | null };
}

export interface JiraRunwayMutations {
  update(issueKey: string, patch: RunwayPatch): Promise<void>;
  /** Gives `issueKey` rank `rank`, first unranking `fromKey` when it holds it. */
  moveRank(issueKey: string, rank: RunwayRank, fromKey?: string): Promise<void>;
}

/**
 * Writes through runwayUpdate. Each failure is toasted and rethrown, so a
 * caller can stop a spinner; the list is refetched after every write, failed
 * or not, so the UI never shows a value the database does not hold.
 */
export function useJiraRunwayMutations(workspaceId: string): JiraRunwayMutations {
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const update = useCallback(async (issueKey: string, patch: RunwayPatch) => {
    try {
      const result = await window.vermilian.runwayUpdate({ workspaceId, issueId: jiraRunwayId(issueKey), patch });
      if (!result.ok) {
        showToast('negative', result.error);
        throw new Error(result.error);
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: jiraRunwayQueryKey(workspaceId) });
    }
  }, [workspaceId, queryClient, showToast]);

  const moveRank = useCallback(async (issueKey: string, rank: RunwayRank, fromKey?: string) => {
    // Free the slot first: the database holds one issue per rank.
    if (fromKey !== undefined && fromKey !== issueKey) await update(fromKey, { focusRank: null });
    await update(issueKey, { focusRank: rank });
  }, [update]);

  return { update, moveRank };
}

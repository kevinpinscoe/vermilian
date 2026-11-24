// Priority Desk Daily Review (VERM-9). Only "recently completed" goes
// through main-process IPC (see main/ipc.ts's dailyReviewGet handler) — the
// board-derived sections (Now/Next/Then, blocked-focused, needs-attention)
// are covered by boardData.ts, riding the board query React Query already
// caches. Re-fetches on every mount/staleTime expiry, same as masterPlanApi.
//
// Completed work is cached per workspace (VERM-114 review). Each request
// names the workspace its view is for, the cache entry is keyed by that
// workspace, and an answer naming any other workspace is refused — so a slow
// answer for workspace A, arriving after the user has moved to B, can only
// ever land in A's entry and never fills B's view.
import { useQuery } from '@tanstack/react-query';
import type { DailyReviewGetArgs, DailyReviewGetResult } from '../../../shared/ipc';
import { useActiveWorkspace } from '../workspace-nav/api';

export const DAILY_REVIEW_COMPLETED_QUERY_KEY = ['youtrack', 'daily-review-completed'] as const;

/** One workspace's cache entry; DAILY_REVIEW_COMPLETED_QUERY_KEY is the prefix of every one. */
export const dailyReviewCompletedQueryKey = (workspaceId: string) =>
  [...DAILY_REVIEW_COMPLETED_QUERY_KEY, workspaceId] as const;

export const DAILY_REVIEW_WRONG_WORKSPACE_MESSAGE =
  'The Daily Review answer was for a different workspace, so it was not shown.';

type DailyReviewGet = (args: DailyReviewGetArgs) => Promise<DailyReviewGetResult>;

/** The query for one workspace's completed work; `get` is injectable for tests. */
export function dailyReviewCompletedQuery(
  workspaceId: string,
  get: DailyReviewGet = (args) => window.vermilian.dailyReviewGet(args),
) {
  return {
    queryKey: dailyReviewCompletedQueryKey(workspaceId),
    queryFn: async (): Promise<DailyReviewGetResult> => {
      const result = await get({ workspaceId });
      if ((result.workspaceId ?? '') !== workspaceId) throw new Error(DAILY_REVIEW_WRONG_WORKSPACE_MESSAGE);
      // Refused because the workspace was not active when the read started:
      // an error, not an answer, so the entry is fetched again next time.
      if (result.refused === 'not-active') throw new Error(result.error ?? 'That workspace is no longer active.');
      return result;
    },
    staleTime: 60_000,
  };
}

export function useDailyReviewCompleted() {
  const active = useActiveWorkspace();
  const workspaceId = active.data?.workspaceId ?? '';
  return useQuery<DailyReviewGetResult>({
    ...dailyReviewCompletedQuery(workspaceId),
    // Wait for the active workspace, so the first request names it.
    enabled: active.data !== undefined,
  });
}

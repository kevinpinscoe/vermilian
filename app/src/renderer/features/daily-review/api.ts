// Priority Desk Daily Review (VERM-9). Only "recently completed" goes
// through main-process IPC (see main/ipc.ts's dailyReviewGet handler) — the
// board-derived sections (Now/Next/Then, blocked-focused, needs-attention)
// are covered by boardData.ts, riding the board query React Query already
// caches. Re-fetches on every mount/staleTime expiry, same as masterPlanApi.
import { useQuery } from '@tanstack/react-query';
import type { DailyReviewGetResult } from '../../../shared/ipc';

export const DAILY_REVIEW_COMPLETED_QUERY_KEY = ['youtrack', 'daily-review-completed'];

export function useDailyReviewCompleted() {
  return useQuery<DailyReviewGetResult>({
    queryKey: DAILY_REVIEW_COMPLETED_QUERY_KEY,
    queryFn: () => window.vermilian.dailyReviewGet(),
    staleTime: 60_000,
  });
}

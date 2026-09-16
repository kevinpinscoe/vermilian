// React Query wrapper for the _vermilian-master-plan Knowledge Base article
// (ADR-0008). Deliberately the same refresh lifecycle Priority Desk's own
// issue queries already use (candidates.ts: `staleTime: 60_000`) rather than
// a bespoke cache — the main process re-fetches and re-parses on every call
// (see main/services/masterPlan.ts), so this staleTime is what actually
// governs how often a hand-edit in YouTrack shows up here.
import { useQuery } from '@tanstack/react-query';
import type { MasterPlanState } from '../../../shared/masterPlan';

export const MASTER_PLAN_QUERY_KEY = ['youtrack', 'master-plan'];

export function useMasterPlan() {
  return useQuery<MasterPlanState>({
    queryKey: MASTER_PLAN_QUERY_KEY,
    queryFn: () => window.vermilian.getMasterPlan(),
    staleTime: 60_000,
  });
}

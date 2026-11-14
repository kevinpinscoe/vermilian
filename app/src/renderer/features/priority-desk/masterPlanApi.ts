// React Query wrapper for the master plan (ADR-0008). Deliberately the same
// refresh lifecycle Priority Desk's own issue queries already use
// (candidates.ts: `staleTime: 60_000`) rather than a bespoke cache — the main
// process re-fetches and re-parses on every call (see
// main/services/masterPlan.ts), so this staleTime is what actually governs
// how often a hand-edit in YouTrack shows up here.
//
// Keyed by the active workspace (VERM-48): each workspace may have its own
// plan or none, so switching workspaces switches the query, and an answer
// that arrives for a workspace the user has left lands in that workspace's
// entry, never on the new one's desk.
import { useQuery } from '@tanstack/react-query';
import type { MasterPlanState } from '../../../shared/masterPlan';
import { useActiveWorkspace } from '../workspace-nav/api';

export const MASTER_PLAN_QUERY_KEY = ['youtrack', 'master-plan'] as const;

export const masterPlanQueryKey = (workspaceId: string) => [...MASTER_PLAN_QUERY_KEY, workspaceId] as const;

export function useMasterPlan() {
  const workspaceId = useActiveWorkspace().data?.workspaceId;
  return useQuery<MasterPlanState>({
    queryKey: masterPlanQueryKey(workspaceId ?? ''),
    queryFn: () => window.vermilian.getMasterPlan(workspaceId),
    enabled: workspaceId !== undefined,
    // A refused or superseded read (the workspace was not active when the
    // main process checked) is never treated as fresh: it is re-read as soon
    // as this workspace's desk is shown again.
    staleTime: (q) => (q.state.data?.kind === 'workspace-not-active' ? 0 : 60_000),
  });
}

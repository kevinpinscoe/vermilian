// React Query hooks for the Runway view (VERM-85). The stored order and the
// tracker reads are two queries: the order is local and answers at once, and
// the rows show in place while the tracker is still being read.

import { useQuery } from '@tanstack/react-query';

/** The stored Runway rows of one workspace (runwayItemsList). */
export const RUNWAY_ITEMS_QUERY_KEY = (workspaceId: string) => ['runway-items', workspaceId] as const;
/** The tracker reads of one workspace's Runway tickets (runwayItemsResolve). */
export const RUNWAY_TICKETS_QUERY_KEY = (workspaceId: string) => ['runway-tickets', workspaceId] as const;

/** `workspaceId` null or '' disables the query. */
export function useRunwayItems(workspaceId: string | null) {
  return useQuery({
    queryKey: RUNWAY_ITEMS_QUERY_KEY(workspaceId ?? ''),
    queryFn: () => window.vermilian.runwayItemsList({ workspaceId: workspaceId as string }),
    enabled: Boolean(workspaceId),
  });
}

export function useRunwayTickets(workspaceId: string | null) {
  return useQuery({
    queryKey: RUNWAY_TICKETS_QUERY_KEY(workspaceId ?? ''),
    queryFn: () => window.vermilian.runwayItemsResolve({ workspaceId: workspaceId as string }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

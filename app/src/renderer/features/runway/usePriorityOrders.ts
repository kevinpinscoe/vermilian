// Each YouTrack project's configured Priority bundle order (VERM-92), for the
// Tracker priority sort: read-only, on the workspace's own connection, only
// while `enabled`. A project not yet read, or not readable, is missing from
// the map, so its tickets rank as unknown.

import { useQuery } from '@tanstack/react-query';

const EMPTY: Record<string, string[]> = {};

export function useYouTrackPriorityOrders(
  workspaceId: string,
  projectShortNames: readonly string[],
  enabled: boolean,
): Record<string, string[]> {
  const names = [...new Set(projectShortNames)].sort();
  const q = useQuery({
    queryKey: ['youtrack', 'priority-orders', workspaceId, names.join(',')],
    queryFn: () => window.vermilian.youtrackPriorityOrders({ workspaceId, projectShortNames: names }),
    enabled: enabled && Boolean(workspaceId) && names.length > 0,
    staleTime: 10 * 60_000,
  });
  return q.data?.ok ? q.data.orders : EMPTY;
}

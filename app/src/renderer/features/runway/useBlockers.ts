// Blocker hooks (VERM-98): the active workspace's prerequisite link types and
// its Runway rows, shared by the Runway view and the All tasks badge. Both
// read the caches the Runway already keeps, so a badge adds no tracker
// request of its own.

import { useMemo } from 'react';
import type { PrerequisiteLinkType } from '../../../shared/issueLink';
import type { TrackerKind } from '../../../shared/tracker';
import { useWorkspaceConfig } from '../workspace-nav/api';
import { useRunwayItems, useRunwayTickets } from './api';
import { prerequisiteTypesFor } from './blockers';
import { buildRunwayRows, type RunwayRow } from './rows';

/** The workspace's prerequisite link types: its own choice, else its tracker's default. */
export function usePrerequisiteTypes(workspaceId: string, tracker: TrackerKind): readonly PrerequisiteLinkType[] {
  const config = useWorkspaceConfig();
  const workspace = config.data?.workspaces.find((w) => w.id === workspaceId);
  return useMemo(() => prerequisiteTypesFor(workspace, tracker), [workspace, tracker]);
}

/** The workspace's Runway rows, from the cached order and reads; [] until the order is known. */
export function useRunwayRows(workspaceId: string): RunwayRow[] {
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);
  const readError = tickets.data && !tickets.data.ok ? tickets.data.error : tickets.error ? String(tickets.error) : null;
  return useMemo(
    () => (items.data?.ok ? buildRunwayRows(items.data.items, tickets.data?.ok ? tickets.data.tickets : null, readError) : []),
    [items.data, tickets.data, readError],
  );
}

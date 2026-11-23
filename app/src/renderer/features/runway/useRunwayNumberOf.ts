// A ticket's Runway # on a workspace's Runway, for the sorts (VERM-92/93):
// null when it has none or its position cannot be verified (both sort last).
// Reads the Runway view's own queries; never writes.

import type { TrackerKind } from '../../../shared/tracker';
import type { BoardIssue } from '../../../shared/workspace';
import { useRunwayItems, useRunwayTickets } from './api';
import { runwayTicketStatus } from './RunwayNumberControl';

export function useRunwayNumberOf(workspaceId: string, tracker: TrackerKind): (issue: BoardIssue) => number | null {
  const items = useRunwayItems(workspaceId || null);
  const tickets = useRunwayTickets(workspaceId || null);
  return (issue) => {
    const status = runwayTicketStatus(items, tickets, {
      tracker,
      keys: [issue.idReadable],
      entityId: tracker === 'youtrack' ? issue.id : null,
    });
    return status?.kind === 'on' ? status.row.runwayNumber : null;
  };
}

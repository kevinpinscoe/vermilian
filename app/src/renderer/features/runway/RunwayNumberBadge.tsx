// A ticket's Runway # on the Priority Desk (VERM-99): read-only, on the Now,
// Next and Then cards and YouTrack's Choose next candidates. Blank when the
// ticket is not on the active workspace's Runway or the order is not known
// yet; "?" when its position cannot be verified. Never writes, and never
// changes the Desk's own order.

import React from 'react';
import { useRunwayItems, useRunwayTickets } from './api';
import { runwayTicketStatus } from './RunwayNumberControl';
import type { PanelTicket } from './rows';
import styles from './DeskSlotChip.module.css';

export function RunwayNumberBadge({ workspaceId, ticket, testId = 'desk-runway-number' }: {
  workspaceId: string;
  ticket: PanelTicket;
  testId?: string;
}) {
  const items = useRunwayItems(workspaceId || null);
  const tickets = useRunwayTickets(workspaceId || null);
  if (!workspaceId) return null;
  const status = runwayTicketStatus(items, tickets, ticket);
  if (status?.kind === 'on') {
    const n = status.row.runwayNumber;
    return (
      <span className={styles.chip} title={`Runway #${n} in this workspace`} data-testid={testId} data-runway-number={n}>
        Runway #{n}
      </span>
    );
  }
  if (status?.kind === 'unverified') {
    return (
      <span className={styles.chip} title="Unable to verify this ticket's Runway position" data-testid={testId} data-runway-number="?">
        Runway #?
      </span>
    );
  }
  return null;
}

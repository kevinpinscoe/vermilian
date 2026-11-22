// Runway view (VERM-85): the active workspace's Runway in its saved order —
// numbered tickets, section headings and notes — opened from the left rail.
// Works for YouTrack and Jira workspaces alike, including one with no board
// projects: the order comes from the local store (runwayItemsList), and each
// ticket's details from its tracker on the workspace's own connection
// (runwayItemsResolve, VERM-84).
//
// Every saved row stays in place whatever the tracker says. A resolved ticket
// opens the workspace's existing detail panel; one that did not resolve shows
// its state and the reason. Tickets are added from the Add box (VERM-86);
// removing and reordering are VERM-87.

import React, { useMemo } from 'react';
import { AttentionBox, Heading, Text } from '@vibe/core';
import type { BoardIssue } from '../../../shared/workspace';
import type { TrackerKind } from '../../../shared/tracker';
import type { SearchScope } from '../search/api';
import { useRunwayItems, useRunwayTickets } from './api';
import { RunwayAddBox } from './RunwayAddBox';
import { buildRunwayRows, ticketStateBadge, type RunwayRow } from './rows';
import styles from './RunwayView.module.css';

export interface RunwayViewProps {
  workspaceId: string;
  workspaceName: string;
  /** The workspace's tracker: what its Add box accepts keys and links for. */
  tracker: TrackerKind;
  /** The workspace's ordinary search scope, for the Add box (VERM-61). */
  searchScope: SearchScope;
  /** Opens a resolved ticket in the active workspace's detail panel. */
  onOpenTicket(issue: BoardIssue): void;
}

export function RunwayView({ workspaceId, workspaceName, tracker, searchScope, onOpenTicket }: RunwayViewProps) {
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);

  const itemsError = items.data && !items.data.ok ? items.data.error : items.error ? String(items.error) : null;
  const readError = tickets.data && !tickets.data.ok ? tickets.data.error : tickets.error ? String(tickets.error) : null;
  const rows = useMemo(
    () =>
      buildRunwayRows(
        items.data?.ok ? items.data.items : [],
        tickets.data?.ok ? tickets.data.tickets : null,
        readError,
      ),
    [items.data, tickets.data, readError],
  );

  return (
    <div className={styles.runway} data-testid="runway-view">
      <div className={styles.header}>
        <Heading type="h2" weight="bold" className={styles.title}>
          Runway
        </Heading>
        <Text type="text2" className={styles.subtitle}>
          {workspaceName}
        </Text>
      </div>

      <RunwayAddBox key={workspaceId} workspaceId={workspaceId} tracker={tracker} searchScope={searchScope} />

      {itemsError && (
        <div className={styles.banner}>
          <AttentionBox type="negative" title="The Runway could not be read" text={itemsError} data-testid="runway-items-error" />
        </div>
      )}
      {!itemsError && readError && (
        <div className={styles.banner}>
          <AttentionBox
            type="warning"
            title="Ticket details could not be refreshed"
            text={`${readError} The Runway order below is unchanged.`}
            data-testid="runway-read-error"
          />
        </div>
      )}

      <div className={styles.list} data-testid="runway-list">
        {items.data?.ok && rows.length === 0 && (
          <div className={styles.empty} data-testid="runway-empty">
            <Text type="text1">This workspace’s Runway is empty.</Text>
          </div>
        )}
        {rows.map((row) => (
          <RunwayRowView key={row.itemId} row={row} onOpenTicket={onOpenTicket} />
        ))}
      </div>
    </div>
  );
}

function RunwayRowView({ row, onOpenTicket }: { row: RunwayRow; onOpenTicket(issue: BoardIssue): void }) {
  const indent = { paddingLeft: 24 + row.depth * 20 };
  if (row.kind !== 'ticket') {
    return (
      <div
        className={row.kind === 'section' ? styles.section : styles.note}
        style={indent}
        data-testid="runway-row"
        data-row-kind={row.kind}
        data-item-id={row.itemId}
      >
        {row.text}
      </div>
    );
  }
  const badge = ticketStateBadge(row.state);
  const issue = row.issue;
  const content = (
    <>
      <span className={styles.number} data-testid="runway-number">
        {row.runwayNumber}
      </span>
      <span className={styles.ticketId} data-testid="runway-ticket-id">
        {row.ticketId}
      </span>
      <span className={styles.summary}>{issue?.summary ?? ''}</span>
      {badge && (
        <span className={`${styles.badge} ${row.state === 'loading' ? styles.badgeQuiet : ''}`} data-testid="runway-state">
          {badge}
        </span>
      )}
      {row.reason && (
        <span className={styles.reason} data-testid="runway-reason">
          {row.reason}
        </span>
      )}
    </>
  );
  const common = {
    'data-testid': 'runway-row',
    'data-row-kind': 'ticket',
    'data-item-id': row.itemId,
    'data-state': row.state,
    style: indent,
  };
  return issue ? (
    <button type="button" className={`${styles.ticket} ${styles.ticketOpenable}`} onClick={() => onOpenTicket(issue)} {...common}>
      {content}
    </button>
  ) : (
    <div className={styles.ticket} {...common}>
      {content}
    </div>
  );
}

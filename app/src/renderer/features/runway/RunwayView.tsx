// Runway view (VERM-85): the active workspace's Runway in its saved order —
// numbered tickets, section headings and notes — opened from the left rail.
// Works for YouTrack and Jira workspaces alike, including one with no board
// projects: the order comes from the local store (runwayItemsList), and each
// ticket's details from its tracker on the workspace's own connection
// (runwayItemsResolve, VERM-84).
//
// Every saved row stays in place whatever the tracker says. A resolved ticket
// opens the workspace's existing detail panel; one that did not resolve shows
// its state and the reason. Tickets are added from the Add box (VERM-86).
//
// Row actions (VERM-87), each one store transaction through the write gate:
//   - every row: drag by its handle, ↑ / ↓ (swap with the row immediately
//     beside it — crossing a heading or note keeps the Runway #, crossing a
//     ticket changes it by one), and Remove, confirmed inline on the row;
//   - ticket rows also: Move to #N, and typing a number in the row's # field.
// Removing takes the row off this workspace's Runway only: the tracker
// ticket, and its rows on other workspaces' Runways, are untouched.
//
// Blockers (VERM-98): each read ticket shows its state — Ready, Blocked,
// Unknown or Done — from the VERM-97 engine, with its open blockers (#N here
// or external) and any order conflict. Two explicit actions, each one store
// transaction: Add to Runway puts an external blocker immediately above its
// dependent, and Move prerequisite above moves a prerequisite immediately
// above its dependent; every other row keeps its relative order. Refresh
// re-reads the tickets past the one-minute cache and never writes the order.

import React, { useMemo, useState } from 'react';
import { AttentionBox, Button, Heading, Text } from '@vibe/core';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardIssue } from '../../../shared/workspace';
import type { TrackerKind } from '../../../shared/tracker';
import type { SearchScope } from '../search/api';
import { useRunwayEdit, useRunwayItems, useRunwayTickets, type RunwayEdit } from './api';
import { RunwayAddBox } from './RunwayAddBox';
import {
  describeBlockerReport,
  describeOrderConflict,
  describePrerequisite,
  type BlockerReport,
} from '../../../shared/blockerState';
import {
  BLOCKER_STATE_LABEL,
  blockerAliases,
  linkedEntityId,
  rowForKey,
  runwayBlockers,
} from './blockers';
import { usePrerequisiteTypes } from './useBlockers';
import {
  buildRunwayRows,
  dropPosition,
  movedItems,
  parseRunwayNumber,
  removePrompt,
  ticketStateBadge,
  type RunwayRow,
} from './rows';
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

/** Which inline control a row has open; one row at a time. */
type RowMode = { itemId: string; kind: 'remove' | 'move-to' | 'number' } | null;

const BAD_NUMBER = 'The Runway # must be a whole number of 1 or more.';

export function RunwayView({ workspaceId, workspaceName, tracker, searchScope, onOpenTicket }: RunwayViewProps) {
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);
  const edit = useRunwayEdit(workspaceId);
  const [mode, setMode] = useState<RowMode>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const itemsError = items.data && !items.data.ok ? items.data.error : items.error ? String(items.error) : null;
  const readError = tickets.data && !tickets.data.ok ? tickets.data.error : tickets.error ? String(tickets.error) : null;
  const stored = useMemo(() => (items.data?.ok ? items.data.items : []), [items.data]);
  const rows = useMemo(
    () => buildRunwayRows(stored, tickets.data?.ok ? tickets.data.tickets : null, readError),
    [stored, tickets.data, readError],
  );
  const prerequisiteTypes = usePrerequisiteTypes(workspaceId, tracker);
  const blockers = useMemo(() => runwayBlockers(rows, prerequisiteTypes), [rows, prerequisiteTypes]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function act(change: RunwayEdit, preview?: Parameters<typeof edit.run>[1]) {
    setInputError(null);
    const ok = await edit.run(change, preview);
    if (ok) setMode(null);
  }

  function moveToTyped(itemId: string, text: string) {
    const n = parseRunwayNumber(text);
    if (n === undefined) {
      setMode(null);
      return;
    }
    if (n === null) {
      setInputError(BAD_NUMBER);
      return;
    }
    void act({ op: 'moveToNumber', itemId, runwayNumber: n });
  }

  function onDragEnd(e: DragEndEvent) {
    const itemId = String(e.active.id);
    const position = dropPosition(rows, itemId, e.over ? String(e.over.id) : null);
    if (position === null) return;
    void act({ op: 'move', itemId, position }, movedItems(stored, itemId, position));
  }

  /**
   * Add to Runway: the external blocker goes in immediately above its
   * dependent. The dependent is named by its stored ID; the main process
   * finds where it is inside the transaction and refuses a ticket already on
   * the Runway under any of its IDs, or a workspace switch while it waits.
   */
  function addBlocker(dependent: RunwayRow, key: string) {
    if (dependent.kind !== 'ticket' || !dependent.issue) return;
    const aliases = blockerAliases(tracker, key, linkedEntityId(dependent.issue, key));
    if (aliases.length === 0) return;
    void act({ op: 'addAbove', issueId: aliases[0], aliases, dependentItemId: dependent.itemId });
  }

  /** Move prerequisite above: the prerequisite moves immediately above its dependent, wherever that is then. */
  function movePrerequisiteAbove(dependent: RunwayRow, key: string) {
    if (dependent.kind !== 'ticket' || !dependent.issue) return;
    const prerequisite = rowForKey(rows, key, linkedEntityId(dependent.issue, key));
    if (prerequisite) void act({ op: 'moveAbove', itemId: prerequisite.itemId, dependentItemId: dependent.itemId });
  }

  const error = inputError ?? edit.error;

  return (
    <div className={styles.runway} data-testid="runway-view">
      <div className={styles.header}>
        <Heading type="h2" weight="bold" className={styles.title}>
          Runway
        </Heading>
        <Text type="text2" className={styles.subtitle}>
          {workspaceName}
        </Text>
        {/* Re-reads the tickets past the one-minute cache; never writes the order (VERM-98). */}
        <Button
          size="small"
          kind="tertiary"
          className={styles.refresh}
          data-testid="runway-refresh"
          disabled={tickets.isFetching}
          onClick={() => void tickets.refetch()}
        >
          {tickets.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
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
      {error && (
        <div className={styles.editError} role="alert" data-testid="runway-edit-error">
          {error}
        </div>
      )}

      <div className={styles.list} data-testid="runway-list" aria-busy={edit.pending || undefined}>
        {items.data?.ok && rows.length === 0 && (
          <div className={styles.empty} data-testid="runway-empty">
            <Text type="text1">This workspace’s Runway is empty.</Text>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rows.map((r) => r.itemId)} strategy={verticalListSortingStrategy}>
            {rows.map((row, index) => (
              <RunwayRowView
                key={row.itemId}
                row={row}
                first={index === 0}
                last={index === rows.length - 1}
                busy={edit.pending}
                mode={mode?.itemId === row.itemId ? mode.kind : null}
                setMode={(kind) => {
                  setInputError(null);
                  setMode(kind ? { itemId: row.itemId, kind } : null);
                }}
                onEdit={(change) => void act(change)}
                onMoveToTyped={(text) => moveToTyped(row.itemId, text)}
                onOpenTicket={onOpenTicket}
                blocker={blockers.get(row.itemId) ?? null}
                onAddBlocker={(key) => addBlocker(row, key)}
                onMovePrerequisiteAbove={(key) => movePrerequisiteAbove(row, key)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

interface RowProps {
  row: RunwayRow;
  first: boolean;
  last: boolean;
  busy: boolean;
  mode: 'remove' | 'move-to' | 'number' | null;
  setMode(kind: 'remove' | 'move-to' | 'number' | null): void;
  onEdit(change: RunwayEdit): void;
  onMoveToTyped(text: string): void;
  onOpenTicket(issue: BoardIssue): void;
  /** The ticket's blocker report; null for a row the tracker did not read. */
  blocker: BlockerReport | null;
  onAddBlocker(key: string): void;
  onMovePrerequisiteAbove(key: string): void;
}

/** Stops a control's click from also opening the row's ticket. */
const own = (fn: () => void) => (e: React.SyntheticEvent) => {
  e.stopPropagation();
  fn();
};

function RunwayRowView({
  row, first, last, busy, mode, setMode, onEdit, onMoveToTyped, onOpenTicket, blocker, onAddBlocker, onMovePrerequisiteAbove,
}: RowProps) {
  const sortable = useSortable({ id: row.itemId, disabled: busy || mode !== null });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.6 : undefined,
  };
  const indent = { paddingLeft: row.depth * 20 };
  const issue = row.kind === 'ticket' ? row.issue : null;

  const rowAttrs = {
    ref: sortable.setNodeRef,
    style,
    'data-testid': 'runway-row',
    'data-row-kind': row.kind,
    'data-item-id': row.itemId,
    ...(row.kind === 'ticket' ? { 'data-state': row.state } : {}),
  };

  const handle = (
    <button
      type="button"
      className={styles.handle}
      aria-label={row.kind === 'ticket' ? `Drag ${row.ticketId}` : `Drag this ${row.kind === 'section' ? 'heading' : 'note'}`}
      data-testid="runway-drag-handle"
      disabled={busy || mode !== null}
      onClick={(e) => e.stopPropagation()}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      ⋮⋮
    </button>
  );

  if (mode === 'remove') {
    return (
      <div {...rowAttrs} className={`${styles.row} ${styles.confirmRow}`}>
        {handle}
        <span className={styles.confirmText} data-testid="runway-remove-prompt">
          {removePrompt(row)}
        </span>
        <span className={styles.controls}>
          <Button size="small" kind="primary" color="negative" disabled={busy} data-testid="runway-remove-confirm"
            onClick={() => onEdit({ op: 'remove', itemId: row.itemId })}>
            Remove
          </Button>
          <Button size="small" kind="tertiary" disabled={busy} data-testid="runway-remove-cancel" onClick={() => setMode(null)}>
            Cancel
          </Button>
        </span>
      </div>
    );
  }

  const controls = (
    <span className={styles.controls}>
      {row.kind === 'ticket' && mode === 'move-to' ? (
        <NumberForm
          label={`Move ${row.ticketId} to Runway #`}
          initial=""
          busy={busy}
          testId="runway-move-to-input"
          submitTestId="runway-move-to-submit"
          submitLabel="Move"
          onSubmit={onMoveToTyped}
          onCancel={() => setMode(null)}
        />
      ) : (
        <>
          <button type="button" className={styles.control} aria-label="Move up" title="Move up" data-testid="runway-move-up"
            disabled={busy || first} onClick={own(() => onEdit({ op: 'moveUp', itemId: row.itemId }))}>
            ↑
          </button>
          <button type="button" className={styles.control} aria-label="Move down" title="Move down" data-testid="runway-move-down"
            disabled={busy || last} onClick={own(() => onEdit({ op: 'moveDown', itemId: row.itemId }))}>
            ↓
          </button>
          {row.kind === 'ticket' && (
            <button type="button" className={styles.control} title="Move to Runway #…" data-testid="runway-move-to"
              disabled={busy} onClick={own(() => setMode('move-to'))}>
              Move to #
            </button>
          )}
          <button type="button" className={styles.control} title="Remove from this Runway" data-testid="runway-remove"
            disabled={busy} onClick={own(() => setMode('remove'))}>
            Remove
          </button>
        </>
      )}
    </span>
  );

  if (row.kind !== 'ticket') {
    return (
      <div {...rowAttrs} className={`${styles.row} ${styles.structRow}`}>
        {handle}
        <span className={row.kind === 'section' ? styles.section : styles.note} style={indent} data-testid="runway-row-text">
          {row.text}
        </span>
        {controls}
      </div>
    );
  }

  const badge = ticketStateBadge(row.state);
  const number =
    mode === 'number' ? (
      <NumberForm
        label={`Runway # for ${row.ticketId}`}
        initial={String(row.runwayNumber)}
        busy={busy}
        testId="runway-number-input"
        onSubmit={onMoveToTyped}
        onCancel={() => setMode(null)}
        compact
      />
    ) : (
      <button
        type="button"
        className={styles.number}
        title="Type a Runway # to move this ticket"
        aria-label={`Runway #${row.runwayNumber}. Type a number to move ${row.ticketId}`}
        data-testid="runway-number"
        disabled={busy}
        onClick={own(() => setMode('number'))}
      >
        {row.runwayNumber}
      </button>
    );
  const details = (
    <>
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
  return (
    <div
      {...rowAttrs}
      className={`${styles.row} ${styles.ticketRow} ${issue ? styles.ticketOpenable : ''}`}
      onClick={issue ? () => onOpenTicket(issue) : undefined}
    >
      {handle}
      {number}
      {issue ? (
        <button type="button" className={styles.ticket} style={indent} aria-label={`Open ${row.ticketId}`}>
          {details}
        </button>
      ) : (
        <div className={styles.ticket} style={indent}>
          {details}
        </div>
      )}
      {blocker && (
        <BlockerView report={blocker} busy={busy} onAddBlocker={onAddBlocker} onMovePrerequisiteAbove={onMovePrerequisiteAbove} />
      )}
      {controls}
    </div>
  );
}

/** A ticket's blocker state, its reason, and its two explicit actions. */
function BlockerView({ report, busy, onAddBlocker, onMovePrerequisiteAbove }: {
  report: BlockerReport;
  busy: boolean;
  onAddBlocker(key: string): void;
  onMovePrerequisiteAbove(key: string): void;
}) {
  const external = report.blockers.filter((b) => b.runwayNumber === null);
  const detail = report.state === 'blocked' || report.state === 'unknown' ? describeBlockerReport(report) : null;
  return (
    <span className={styles.blocker} data-testid="runway-blocker" data-blocker-state={report.state} onClick={(e) => e.stopPropagation()}>
      <span className={`${styles.blockerState} ${styles[`blocker_${report.state}`] ?? ''}`} data-testid="runway-blocker-state">
        {BLOCKER_STATE_LABEL[report.state]}
      </span>
      {detail && (
        <span className={styles.blockerText} data-testid="runway-blocker-text">
          {detail}
        </span>
      )}
      {external.map((b) => (
        <button key={b.key} type="button" className={styles.control} data-testid="runway-add-blocker" data-key={b.key}
          disabled={busy} title={`Add ${describePrerequisite(b)} immediately above this ticket`}
          onClick={own(() => onAddBlocker(b.key))}>
          Add {b.key} to Runway
        </button>
      ))}
      {report.orderConflicts.map((c) => (
        <span key={c.key} className={styles.conflict} data-testid="runway-order-conflict" data-key={c.key} data-certain={String(c.certain)}>
          <span className={c.certain ? styles.conflictText : styles.blockerText}>{describeOrderConflict(c)}</span>
          <button type="button" className={styles.control} data-testid="runway-move-prerequisite" data-key={c.key}
            disabled={busy} title={`Move ${c.key} immediately above this ticket`}
            onClick={own(() => onMovePrerequisiteAbove(c.key))}>
            Move prerequisite above
          </button>
        </span>
      ))}
    </span>
  );
}

interface NumberFormProps {
  label: string;
  initial: string;
  busy: boolean;
  testId: string;
  submitTestId?: string;
  submitLabel?: string;
  compact?: boolean;
  onSubmit(text: string): void;
  onCancel(): void;
}

/** A Runway # entry: Enter (or the button) submits, Escape cancels. */
function NumberForm({ label, initial, busy, testId, submitTestId, submitLabel, compact, onSubmit, onCancel }: NumberFormProps) {
  const [text, setText] = useState(initial);
  return (
    <form
      className={styles.numberForm}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <input
        className={compact ? styles.numberInputCompact : styles.numberInput}
        aria-label={label}
        data-testid={testId}
        inputMode="numeric"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {submitLabel && (
        <>
          <Button type="submit" size="small" disabled={busy} data-testid={submitTestId}>
            {submitLabel}
          </Button>
          <Button size="small" kind="tertiary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </form>
  );
}

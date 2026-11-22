// The Runway # control in a ticket's detail panel (VERM-88), for YouTrack and
// Jira alike: the ticket's place on the active workspace's Runway.
//
//   - Not on the Runway: "Add at end", or a # and "Add at #".
//   - On the Runway: its Runway #, a # and "Move to #", and "Remove",
//     confirmed inline (the same prompt as the Runway view's row).
//
// The ticket is matched to its saved row by every ID it goes by, and by the
// row's tracker read (a Jira ticket saved under a key it has since moved
// from) — panelRunwayRow. Move and Remove then use that row's stored ID.
// Add is offered only once it is established that no saved row holds the
// ticket (panelRunwayStatus): while the tracker reads are in flight it waits,
// and if they failed the control says "Unable to verify Runway position"
// with a Retry — the Add handler applies the same check as the buttons.
//
// Adds go through runwayItemsAddByReference, the Runway view Add box's own
// gated add: the main process checks the key on the workspace's connection,
// refuses a duplicate under any ID inside the write gate, and cancels the add
// on any workspace switch. Moves and removes are the Runway view's edits
// (useRunwayEdit), cancelled the same way. Nothing here writes the tracker.
//
// The control is independent of the Priority Desk: a ticket can be on the
// Runway with no Desk slot. Callers key it on the workspace, so a switch
// remounts it and an answer for the old workspace is never shown — but an
// add's result always updates the shared Runway cache of the workspace it
// was made on, even if the panel closed meanwhile, so an open Runway view
// shows it. Only the panel's own feedback waits on it being mounted.

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@vibe/core';
import { useQueryClient } from '@tanstack/react-query';
import type { RunwayAddResult } from '../../../shared/runwayAdd';
import { RUNWAY_ITEMS_QUERY_KEY, RUNWAY_TICKETS_QUERY_KEY, useRunwayEdit, useRunwayItems, useRunwayTickets } from './api';
import { panelRunwayStatus, parseRunwayNumber, type PanelTicket } from './rows';
import styles from './RunwayNumberControl.module.css';

export interface RunwayNumberControlProps {
  /** The active workspace: the Runway this control reads and writes. */
  workspaceId: string;
  ticket: PanelTicket;
  /** The key shown in messages and sent when adding (the tracker's current key). */
  displayKey: string;
}

const BAD_NUMBER = 'The Runway # must be a whole number of 1 or more.';

export function RunwayNumberControl({ workspaceId, ticket, displayKey }: RunwayNumberControlProps) {
  const queryClient = useQueryClient();
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);
  const edit = useRunwayEdit(workspaceId);
  const [numberText, setNumberText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Whether the ticket is on the Runway. A row saved under an ID the panel
  // does not know (a Jira key the ticket moved from) is recognised only by
  // the tracker reads, so until they have answered Add is not offered — and
  // if they failed, the position is reported as unverified, with a retry.
  const readState = tickets.isPending
    ? ({ state: 'pending' } as const)
    : tickets.isError || !tickets.data?.ok
      ? ({ state: 'failed' } as const)
      : ({ state: 'done', reads: tickets.data.tickets, refetching: tickets.isFetching } as const);
  const status = items.data?.ok ? panelRunwayStatus(items.data.items, readState, ticket) : null;
  const row = status?.kind === 'on' ? status.row : null;
  const canAdd = status?.kind === 'off';
  const busy = adding || edit.pending;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: RUNWAY_ITEMS_QUERY_KEY(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: RUNWAY_TICKETS_QUERY_KEY(workspaceId) });
  }

  function readNumber(required: boolean): number | undefined | null {
    const n = parseRunwayNumber(numberText);
    if (n === null || (required && n === undefined)) {
      setMessage({ error: true, text: BAD_NUMBER });
      return null;
    }
    return n;
  }

  async function add(runwayNumber: number | undefined) {
    // The same check as the buttons: never add unless it is established
    // that no saved row already holds this ticket.
    if (!canAdd || busy) return;
    setAdding(true);
    setMessage(null);
    edit.clearError();
    let r: RunwayAddResult;
    try {
      r = await window.vermilian.runwayItemsAddByReference({
        workspaceId,
        reference: displayKey,
        ...(runwayNumber === undefined ? {} : { runwayNumber }),
      });
    } catch (e) {
      r = { ok: false, code: 'refresh-failed', error: String((e as { message?: unknown })?.message ?? e), retryable: true };
    }
    // The shared Runway cache of the workspace the add was made on is
    // updated whatever happened to the panel meanwhile: a Runway view open
    // now must show the write. Only the panel's own feedback needs it mounted.
    if (r.ok) queryClient.setQueryData(RUNWAY_ITEMS_QUERY_KEY(workspaceId), { ok: true, items: r.items });
    invalidate();
    if (!mounted.current) return;
    setAdding(false);
    if (r.ok) {
      const added = r.items.find((i) => i.itemId === r.itemId);
      setNumberText('');
      setMessage({ error: false, text: `Added ${displayKey}${added?.runwayNumber ? ` as #${added.runwayNumber}` : ''}.` });
    } else {
      setMessage({ error: true, text: r.error });
    }
  }

  async function moveTo() {
    if (!row) return;
    const n = readNumber(true);
    if (n === null || n === undefined) return;
    setMessage(null);
    if (await edit.run({ op: 'moveToNumber', itemId: row.itemId, runwayNumber: n })) setNumberText('');
  }

  async function remove() {
    if (!row) return;
    setMessage(null);
    if (await edit.run({ op: 'remove', itemId: row.itemId })) {
      setConfirmRemove(false);
      void queryClient.invalidateQueries({ queryKey: RUNWAY_TICKETS_QUERY_KEY(workspaceId) });
    }
  }

  const error = message?.error ? message.text : edit.error;

  return (
    <section className={styles.control} data-testid="detail-runway" data-runway-number={row?.runwayNumber ?? ''}>
      <div className={styles.headerRow}>
        <span className={styles.label}>Runway #</span>
        <span className={styles.value} data-testid="detail-runway-number">
          {items.isPending || status?.kind === 'checking'
            ? 'Loading…'
            : row
              ? `#${row.runwayNumber}`
              : status?.kind === 'unverified'
                ? 'Unable to verify Runway position'
                : 'Not on this Runway'}
        </span>
        {status?.kind === 'unverified' && (
          <Button size="small" kind="tertiary" disabled={tickets.isFetching} data-testid="detail-runway-retry"
            onClick={() => void tickets.refetch()}>
            Retry
          </Button>
        )}
      </div>

      {items.data && !items.data.ok && (
        <div className={styles.error} role="alert">
          {items.data.error}
        </div>
      )}

      {items.data?.ok && confirmRemove && row ? (
        <div className={styles.actions}>
          <span className={styles.prompt} data-testid="detail-runway-remove-prompt">
            Remove {displayKey} from this Runway?
          </span>
          <Button size="small" kind="primary" color="negative" disabled={busy} data-testid="detail-runway-remove-confirm"
            onClick={() => void remove()}>
            Remove
          </Button>
          <Button size="small" kind="tertiary" disabled={busy} data-testid="detail-runway-remove-cancel"
            onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
        </div>
      ) : items.data?.ok ? (
        <form
          className={styles.actions}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (row) void moveTo();
            else if (canAdd) {
              const n = readNumber(true);
              if (typeof n === 'number') void add(n);
            }
          }}
        >
          {!row && (
            <Button size="small" kind="secondary" disabled={busy || !canAdd} data-testid="detail-runway-add-end"
              onClick={() => void add(undefined)}>
              Add at end
            </Button>
          )}
          <input
            className={styles.number}
            data-testid="detail-runway-number-input"
            aria-label={row ? 'Runway number to move to' : 'Runway number to add at'}
            inputMode="numeric"
            placeholder="#"
            value={numberText}
            disabled={busy}
            onChange={(e) => setNumberText(e.target.value)}
          />
          <Button type="submit" size="small" kind="secondary" disabled={busy || (!row && !canAdd) || numberText.trim() === ''}
            data-testid={row ? 'detail-runway-move' : 'detail-runway-add-at'}>
            {row ? 'Move to #' : 'Add at #'}
          </Button>
          {row && (
            <Button size="small" kind="tertiary" disabled={busy} data-testid="detail-runway-remove"
              onClick={() => {
                setMessage(null);
                setConfirmRemove(true);
              }}>
              Remove
            </Button>
          )}
        </form>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert" data-testid="detail-runway-error">
          {error}
        </div>
      ) : message ? (
        <div className={styles.status} role="status" data-testid="detail-runway-status">
          {message.text}
        </div>
      ) : null}
    </section>
  );
}

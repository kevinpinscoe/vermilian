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
//
// Adds go through runwayItemsAddByReference, the Runway view Add box's own
// gated add: the main process checks the key on the workspace's connection,
// refuses a duplicate under any ID inside the write gate, and cancels the add
// on any workspace switch. Moves and removes are the Runway view's edits
// (useRunwayEdit), cancelled the same way. Nothing here writes the tracker.
//
// The control is independent of the Priority Desk: a ticket can be on the
// Runway with no Desk slot. Callers key it on the workspace, so a switch
// remounts it and an answer for the old workspace is never shown.

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@vibe/core';
import { useQueryClient } from '@tanstack/react-query';
import type { RunwayAddResult } from '../../../shared/runwayAdd';
import { RUNWAY_ITEMS_QUERY_KEY, RUNWAY_TICKETS_QUERY_KEY, useRunwayEdit, useRunwayItems, useRunwayTickets } from './api';
import { panelRunwayRow, parseRunwayNumber, type PanelTicket } from './rows';
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

  const reads = tickets.data?.ok ? tickets.data.tickets : null;
  const row = items.data?.ok ? panelRunwayRow(items.data.items, reads, ticket) : null;
  // Until the tracker reads answer, a row saved under a moved key cannot be
  // recognised yet, so Add waits — it would otherwise add the ticket twice.
  const readsPending = tickets.isPending;
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
    if (!mounted.current) return;
    setAdding(false);
    if (r.ok) {
      const added = r.items.find((i) => i.itemId === r.itemId);
      setNumberText('');
      setMessage({ error: false, text: `Added ${displayKey}${added?.runwayNumber ? ` as #${added.runwayNumber}` : ''}.` });
      queryClient.setQueryData(RUNWAY_ITEMS_QUERY_KEY(workspaceId), { ok: true, items: r.items });
    } else {
      setMessage({ error: true, text: r.error });
    }
    invalidate();
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
          {items.isPending ? 'Loading…' : row ? `#${row.runwayNumber}` : 'Not on this Runway'}
        </span>
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
            else {
              const n = readNumber(true);
              if (typeof n === 'number') void add(n);
            }
          }}
        >
          {!row && (
            <Button size="small" kind="secondary" disabled={busy || readsPending} data-testid="detail-runway-add-end"
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
          <Button type="submit" size="small" kind="secondary" disabled={busy || (!row && readsPending) || numberText.trim() === ''}
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

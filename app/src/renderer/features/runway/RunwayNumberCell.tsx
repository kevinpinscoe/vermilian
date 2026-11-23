// The Runway # of a ticket in All tasks (VERM-90): a cell in the YouTrack
// table and a badge on each Jira card. It shows the ticket's Runway # on the
// active workspace's Runway — blank when it has none, "?" when its position
// cannot be verified — and a click opens a popover holding the detail
// panel's own Runway # control (Add at end, Add at #, Move to #, Remove,
// Retry), so the two can never behave differently.
//
// The row or card under it opens the detail panel on a click or Enter; the
// cell and its popover keep their clicks and keys to themselves. The popover
// is portalled to the document body, so a scrolling table cannot clip it;
// React still bubbles its events through the cell, which stops them.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRunwayItems, useRunwayTickets } from './api';
import { RunwayNumberControl, runwayTicketStatus } from './RunwayNumberControl';
import type { PanelTicket } from './rows';
import styles from './RunwayNumberCell.module.css';

export interface RunwayNumberCellProps {
  workspaceId: string;
  ticket: PanelTicket;
  /** The key shown in messages and sent when adding. */
  displayKey: string;
  /** Extra class for the outer element (layout in the caller's row or card). */
  className?: string;
}

const POPOVER_WIDTH = 300;

export function RunwayNumberCell({ workspaceId, ticket, displayKey, className }: RunwayNumberCellProps) {
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);
  const status = runwayTicketStatus(items, tickets, ticket);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const number = status?.kind === 'on' ? status.row.runwayNumber : null;
  const shown = number !== null ? `#${number}` : status?.kind === 'unverified' ? '?' : '';
  const label =
    number !== null
      ? `Runway #${number} for ${displayKey}: change`
      : status?.kind === 'unverified'
        ? `Unable to verify the Runway position of ${displayKey}`
        : `${displayKey} is not on this Runway: add`;

  // Placed under the cell, kept inside the window.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPlace({ top: r.bottom + 4, left });
  }, [open]);

  // Closed by Escape, a click outside, or the window scrolling or resizing
  // (it would no longer sit under its cell).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span className={`${styles.wrap} ${className ?? ''}`} onClick={stop} onKeyDown={stop} onMouseDown={stop}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.cell} ${open ? styles.cellOpen : ''}`}
        data-testid="runway-cell"
        data-runway-number={number ?? ''}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.number} data-testid="runway-cell-number">{shown}</span>
        <span className={styles.caret} aria-hidden="true">▾</span>
      </button>
      {open &&
        createPortal(
          // Stopped here too: React bubbles portal events through the cell's tree.
          <div
            ref={popoverRef}
            className={styles.popover}
            role="dialog"
            aria-label={`Runway # of ${displayKey}`}
            data-testid="runway-cell-popover"
            style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, width: POPOVER_WIDTH }}
            onClick={stop}
            onKeyDown={stop}
            onMouseDown={stop}
          >
            <RunwayNumberControl workspaceId={workspaceId} ticket={ticket} displayKey={displayKey} testIdPrefix="cell-runway" bare />
          </div>,
          document.body,
        )}
    </span>
  );
}

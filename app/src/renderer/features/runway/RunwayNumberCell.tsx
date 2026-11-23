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
//
// Opening moves keyboard focus into the popover (its number field, else its
// first control); Escape anywhere in it closes it and puts focus back on its
// cell. Only one popover is open at a time: opening another closes it. It
// opens below its cell, or above when there is too little room below (a
// bottom row), so its controls stay on screen.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRunwayItems, useRunwayTickets } from './api';
import { RunwayNumberControl, runwayTicketStatus } from './RunwayNumberControl';
import type { PanelTicket } from './rows';
import { POPOVER_WIDTH, popoverPlacement } from './popoverPlacement';
import styles from './RunwayNumberCell.module.css';

export interface RunwayNumberCellProps {
  workspaceId: string;
  ticket: PanelTicket;
  /** The key shown in messages and sent when adding. */
  displayKey: string;
  /** Extra class for the outer element (layout in the caller's row or card). */
  className?: string;
}

// The one open popover's close, so opening another closes it.
let closeOpenPopover: (() => void) | null = null;


export function RunwayNumberCell({ workspaceId, ticket, displayKey, className }: RunwayNumberCellProps) {
  const items = useRunwayItems(workspaceId);
  const tickets = useRunwayTickets(workspaceId);
  const status = runwayTicketStatus(items, tickets, ticket);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<ReturnType<typeof popoverPlacement> | null>(null);
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

  // Placed once it has rendered (its height decides below or above), then
  // focus moves into it.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    if (!buttonRef.current || !popoverRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPlace(popoverPlacement(r, popoverRef.current.getBoundingClientRect().height, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  useEffect(() => {
    if (!open || !place || !popoverRef.current) return;
    if (popoverRef.current.contains(document.activeElement)) return;
    const target =
      popoverRef.current.querySelector<HTMLElement>('input:not([disabled])') ??
      popoverRef.current.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    target?.focus();
  }, [open, place]);

  // One open popover at a time.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    closeOpenPopover?.();
    closeOpenPopover = close;
    return () => {
      if (closeOpenPopover === close) closeOpenPopover = null;
    };
  }, [open]);

  function closeToCell() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Closed by Escape, a click outside, the window resizing, or a scroll that
  // moves its cell (it would no longer sit beside it).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    // Escape outside the popover (focus left on its cell, say).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // A scroll closes it only once its cell has actually moved: a scroll
    // event still in flight from before it opened leaves it alone.
    const opened = buttonRef.current?.getBoundingClientRect();
    const onScroll = () => {
      const now = buttonRef.current?.getBoundingClientRect();
      if (!opened || !now || Math.abs(now.top - opened.top) > 1 || Math.abs(now.left - opened.left) > 1) close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
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
            data-placement={place?.placement ?? ''}
            style={
              place
                ? { top: place.top, bottom: place.bottom, left: place.left, width: POPOVER_WIDTH }
                : { top: 0, left: 0, width: POPOVER_WIDTH, visibility: 'hidden' }
            }
            onClick={stop}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Escape anywhere in it, the number field included: close, back to the cell.
              if (e.key === 'Escape') {
                e.preventDefault();
                e.nativeEvent.stopImmediatePropagation();
                closeToCell();
              }
            }}
            onMouseDown={stop}
          >
            <RunwayNumberControl workspaceId={workspaceId} ticket={ticket} displayKey={displayKey} testIdPrefix="cell-runway" bare />
          </div>,
          document.body,
        )}
    </span>
  );
}

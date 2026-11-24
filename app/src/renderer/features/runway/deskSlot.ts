// The Priority Desk slot of a ticket, for Runway and All tasks rows (VERM-99).
// Display only: read from the Desk's own data, never written from here. Pure
// — no React, no IPC — so the rules run under vitest.
//
// Kevin's decisions (VERM-99, 2026-11-24):
//   - YouTrack: a slot shows only when the ticket is on the active
//     workspace's Desk, exactly as the Desk shows it: in the workspace's
//     projects, open, Focus rank 1–3. A rank two tickets share shows on both,
//     marked shared (the Desk asks for the repair).
//   - Jira: the workspace's own Desk entry, rank 1–3.
//   - A small read-only Now/Next/Then chip beside the Runway #.

import type { FocusRank, FocusRankHolder } from '../project-board/focus';
import type { RunwayRank } from '../../../shared/runway';
import { decodeIssueId, type TrackerKind } from '../../../shared/tracker';
import type { RunwayRow } from './rows';

export type DeskSlotLabel = 'Now' | 'Next' | 'Then';

export const DESK_SLOT_LABEL: Record<FocusRank, DeskSlotLabel> = { 1: 'Now', 2: 'Next', 3: 'Then' };

export interface DeskSlot {
  rank: FocusRank;
  label: DeskSlotLabel;
  /** True when another ticket holds the same rank (YouTrack only). */
  shared: boolean;
}

/** Slot lookup by every ID a ticket goes by: entity ID and readable key. */
export type DeskSlots = ReadonlyMap<string, DeskSlot>;

/** The YouTrack Desk's slots, from its own rank holders, by entity ID and readable key. */
export function youtrackDeskSlots(byRank: ReadonlyMap<FocusRank, readonly FocusRankHolder[]>): DeskSlots {
  const out = new Map<string, DeskSlot>();
  for (const [rank, holders] of byRank) {
    const slot: DeskSlot = { rank, label: DESK_SLOT_LABEL[rank], shared: holders.length > 1 };
    for (const { issue } of holders) {
      out.set(issue.id, slot);
      out.set(issue.idReadable, slot);
    }
  }
  return out;
}

/** The Jira Desk's slots, from the workspace's entries, by issue key. */
export function jiraDeskSlots(byRank: ReadonlyMap<RunwayRank, string>): DeskSlots {
  const out = new Map<string, DeskSlot>();
  for (const [rank, key] of byRank) out.set(key, { rank, label: DESK_SLOT_LABEL[rank], shared: false });
  return out;
}

/** The slot of the first of a ticket's IDs that holds one; null when none does. */
export function deskSlotOf(slots: DeskSlots, ids: ReadonlyArray<string | null | undefined>): DeskSlot | null {
  for (const id of ids) {
    if (!id) continue;
    const slot = slots.get(id);
    if (slot) return slot;
  }
  return null;
}

/**
 * A Runway row's slot on the workspace's Desk (Kevin's review, VERM-99). The
 * row's stored tracker is verified first: a row stored for another tracker
 * gets none, even when its key matches. Then it is matched by its stored ID
 * and by the IDs the tracker returned for it — entity ID and current key —
 * so a moved Jira ticket keeps its slot under either key.
 */
export function runwayRowDeskSlot(slots: DeskSlots, tracker: TrackerKind, row: RunwayRow): DeskSlot | null {
  if (row.kind !== 'ticket') return null;
  const stored = decodeIssueId(row.itemId);
  if (!stored || stored.kind !== tracker) return null;
  return deskSlotOf(slots, [stored.localId, row.issue?.id, row.issue?.idReadable]);
}

/** The chip's tooltip and accessible name. */
export function deskSlotTitle(slot: DeskSlot): string {
  return slot.shared
    ? `Priority Desk: ${slot.label}, shared with another ticket. Fix it on the Desk.`
    : `Priority Desk: ${slot.label}`;
}

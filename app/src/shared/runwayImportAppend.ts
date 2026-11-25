// What a Markdown import adds to a workspace's Runway (VERM-105). Pure: the
// preview shows it, and the main process works it out again inside Apply's
// transaction. Spec: spec/features/workspace-runway.md, Markdown import.
//
// Additive and append-only. Nothing already on the Runway moves, changes or
// is removed, so every existing Runway # stays. What the file has that the
// Runway does not is appended at the end, in file order.
//
// Tickets are the same when any of their tracker-qualified IDs match, from
// either side: the IDs the file's ticket answered to on the destination's
// connection, and the IDs each saved row answered to when it was read on that
// same connection. A saved jira:DEMO-101 whose read answers DEMO-150 matches a
// file that only says DEMO-150. A saved ticket that could not be read leaves
// its identity uncertain: while one does, no new ticket is offered (Unable to
// verify), since it might be the same ticket under an old key — so a new
// ticket gets no proposed Runway #, and the unreadable one is not listed as
// missing from the file.
//
// Sections and notes match by kind, text and occurrence: the first `Later`
// heading in the file matches the first `Later` section on the Runway, the
// second the second; with two on the Runway and three in the file, only the
// third is appended. Depth is ignored. Text is compared ignoring trailing
// whitespace only; case, leading whitespace and inner spacing count, and the
// stored text is never changed.

import { decodeIssueId } from './tracker';
import type { RunwayItemKind } from './runwayItem';
import type { RunwayImportApplyRow } from './runwayImport';

/** A row already on the destination Runway, as Apply compares it: ID, kind, stored text and depth, in order. */
export interface RunwayDestinationRow {
  itemId: string;
  kind: RunwayItemKind;
  text: string | null;
  depth: number;
}

/** A saved ticket row's identity on the destination's connection. */
export type RunwaySavedIdentity =
  | { itemId: string; state: 'resolved'; key: string; aliases: string[] }
  | { itemId: string; state: 'unverified'; key: string; reason: string };

export interface RunwayAppendPlan {
  /**
   * Per file row, in order: already on the Runway, and the Runway # a ticket
   * has or will have. `uncertain`: a ticket that might already be on the
   * Runway under a key that could not be read; it has no number.
   */
  rows: { present: boolean; runwayNumber: number | null; uncertain?: true }[];
  /** Indices into the file rows to append, in file order. */
  append: number[];
  /** Keys of the Runway's tickets the file does not have: listed only. */
  absent: string[];
  /** Keys of the Runway's tickets whose identity could not be read. */
  unverified: string[];
  /** True when an uncertain saved ticket could be one the plan would add: nothing may be applied. */
  unableToVerify: boolean;
}

const textKey = (kind: string, text: string | null) => `${kind}\n${(text ?? '').trimEnd()}`;

/** The readable key of a saved row, for listing. */
export function savedKey(itemId: string): string {
  const decoded = decodeIssueId(itemId);
  return decoded ? decoded.localId : itemId;
}

/**
 * The append plan for `rows` (the file's rows for one group) against the
 * destination's current rows. `ticketAliases[i]` is every tracker-qualified
 * ID file row i's ticket answered to (its stored ID included); `identities`
 * holds each saved ticket row's, by item ID.
 */
export function planRunwayAppend(
  rows: readonly RunwayImportApplyRow[],
  ticketAliases: readonly (readonly string[] | undefined)[],
  destination: readonly RunwayDestinationRow[],
  identities: Readonly<Record<string, RunwaySavedIdentity | undefined>>,
): RunwayAppendPlan {
  // The saved tickets: each one's IDs, and its Runway #.
  const byAlias = new Map<string, number>();
  const savedTickets: { itemId: string; key: string; number: number; verified: boolean }[] = [];
  for (const row of destination) {
    if (row.kind !== 'issue') continue;
    const id = identities[row.itemId];
    const number = savedTickets.length + 1;
    const verified = id?.state === 'resolved';
    savedTickets.push({ itemId: row.itemId, key: id?.key ?? savedKey(row.itemId), number, verified });
    for (const alias of new Set([row.itemId, ...(id?.state === 'resolved' ? id.aliases : [])])) {
      if (!byAlias.has(alias)) byAlias.set(alias, savedTickets.length - 1);
    }
  }
  // Sections and notes already there, counted by kind and text.
  const counts = new Map<string, number>();
  for (const row of destination) if (row.kind !== 'issue') counts.set(textKey(row.kind, row.text), (counts.get(textKey(row.kind, row.text)) ?? 0) + 1);

  const seen = new Map<string, number>();
  const matched = new Set<number>();
  const appended = new Set<string>();
  const out: RunwayAppendPlan['rows'] = [];
  const append: number[] = [];
  let next = savedTickets.length;
  let newTickets = 0;
  rows.forEach((row, i) => {
    if (row.kind === 'ticket') {
      const aliases = [...new Set([row.issueId, ...(ticketAliases[i] ?? [])])];
      const hit = aliases.map((a) => byAlias.get(a)).find((x) => x !== undefined);
      if (hit !== undefined) {
        matched.add(hit);
        out.push({ present: true, runwayNumber: savedTickets[hit].number });
        return;
      }
      if (aliases.some((a) => appended.has(a))) {
        // Already added by an earlier row of this plan; the preview makes it a duplicate first.
        out.push({ present: true, runwayNumber: null });
        return;
      }
      aliases.forEach((a) => appended.add(a));
      newTickets++;
      out.push({ present: false, runwayNumber: ++next });
      append.push(i);
      return;
    }
    const key = textKey(row.kind, row.text);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n <= (counts.get(key) ?? 0)) {
      out.push({ present: true, runwayNumber: null });
    } else {
      out.push({ present: false, runwayNumber: null });
      append.push(i);
    }
  });

  const unverified = savedTickets.filter((t, i) => !t.verified && !matched.has(i)).map((t) => t.key);
  const unableToVerify = unverified.length > 0 && newTickets > 0;
  if (unableToVerify) {
    // A new ticket might be one of the unreadable ones: no proposed number, and they are not "missing".
    append.forEach((i) => {
      if (rows[i].kind === 'ticket') out[i] = { present: false, runwayNumber: null, uncertain: true };
    });
  }
  return {
    rows: out,
    append,
    absent: savedTickets.filter((t, i) => !matched.has(i) && !(unableToVerify && !t.verified)).map((t) => t.key),
    unverified,
    unableToVerify,
  };
}

/** The destination's rows as Apply compares them. */
export function destinationRows(items: readonly { itemId: string; kind: RunwayItemKind; text: string | null; depth: number }[]): RunwayDestinationRow[] {
  return items.map((i) => ({ itemId: i.itemId, kind: i.kind, text: i.text, depth: i.depth }));
}

/** Whether two destination row lists are the same: ID, kind, stored text and depth, in order. */
export function sameDestinationRows(a: readonly RunwayDestinationRow[], b: readonly RunwayDestinationRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.itemId === b[i].itemId && r.kind === b[i].kind && r.text === b[i].text && r.depth === b[i].depth);
}

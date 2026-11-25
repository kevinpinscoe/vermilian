// React Query hooks for the Runway view (VERM-85). The stored order and the
// tracker reads are two queries: the order is local and answers at once, and
// the rows show in place while the tracker is still being read.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RunwayItemsResult } from '../../../shared/ipc';
import type { RunwayItem } from '../../../shared/runwayItem';

/** The stored Runway rows of one workspace (runwayItemsList). */
export const RUNWAY_ITEMS_QUERY_KEY = (workspaceId: string) => ['runway-items', workspaceId] as const;
/** The tickets already on an import destination's Runway, read on its own connection (runwayImportIdentify, VERM-105). */
export const IMPORT_IDENTITY_QUERY_KEY = ['runway-import-identity'] as const;
/** The tracker reads of one workspace's Runway tickets (runwayItemsResolve). */
export const RUNWAY_TICKETS_QUERY_KEY = (workspaceId: string) => ['runway-tickets', workspaceId] as const;

/** `workspaceId` null or '' disables the query. */
export function useRunwayItems(workspaceId: string | null) {
  return useQuery({
    queryKey: RUNWAY_ITEMS_QUERY_KEY(workspaceId ?? ''),
    queryFn: () => window.vermilian.runwayItemsList({ workspaceId: workspaceId as string }),
    enabled: Boolean(workspaceId),
  });
}

/**
 * The tracker reads of a workspace's Runway tickets. They are kept for a
 * minute, but never behind the stored order: when the order (a local read,
 * shared with every Runway surface) is newer than the reads and holds a ticket
 * they did not read — a row added since, by any route — the reads are taken
 * again (VERM-89). Reads newer than the order are left alone, so this settles.
 */
export function useRunwayTickets(workspaceId: string | null) {
  const items = useRunwayItems(workspaceId);
  const tickets = useQuery({
    queryKey: RUNWAY_TICKETS_QUERY_KEY(workspaceId ?? ''),
    queryFn: () => window.vermilian.runwayItemsResolve({ workspaceId: workspaceId as string }),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
  const stale =
    items.data?.ok === true &&
    tickets.data?.ok === true &&
    !tickets.isFetching &&
    items.dataUpdatedAt > tickets.dataUpdatedAt &&
    unreadTicket(items.data.items, tickets.data.tickets);
  const { refetch } = tickets;
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);
  return tickets;
}

/** Whether a stored ticket row has no read in `reads`. */
export function unreadTicket(items: readonly RunwayItem[], reads: readonly { itemId: string }[]): boolean {
  const read = new Set(reads.map((r) => r.itemId));
  return items.some((i) => i.kind === 'issue' && !read.has(i.itemId));
}

/**
 * One Runway view row action (VERM-87). Each is one store transaction in the
 * main process, through the Runway write gate, on the active workspace only.
 */
export type RunwayEdit =
  | { op: 'remove'; itemId: string }
  | { op: 'moveUp'; itemId: string }
  | { op: 'moveDown'; itemId: string }
  | { op: 'moveToNumber'; itemId: string; runwayNumber: number }
  | { op: 'move'; itemId: string; position: number }
  /**
   * The blocker actions (VERM-98). Each names the dependent by its stored
   * itemId; the main process finds its position inside the transaction.
   */
  | { op: 'addAbove'; issueId: string; aliases: string[]; dependentItemId: string }
  | { op: 'moveAbove'; itemId: string; dependentItemId: string };

function send(workspaceId: string, edit: RunwayEdit): Promise<RunwayItemsResult> {
  const v = window.vermilian;
  switch (edit.op) {
    case 'remove':
      return v.runwayItemsRemove({ workspaceId, itemId: edit.itemId });
    case 'moveUp':
      return v.runwayItemsMoveUp({ workspaceId, itemId: edit.itemId });
    case 'moveDown':
      return v.runwayItemsMoveDown({ workspaceId, itemId: edit.itemId });
    case 'moveToNumber':
      return v.runwayItemsMoveToNumber({ workspaceId, itemId: edit.itemId, runwayNumber: edit.runwayNumber });
    case 'move':
      return v.runwayItemsMove({ workspaceId, itemId: edit.itemId, position: edit.position });
    case 'addAbove':
      return v.runwayItemsAddIssueAbove({ workspaceId, issueId: edit.issueId, aliases: edit.aliases, dependentItemId: edit.dependentItemId });
    case 'moveAbove':
      return v.runwayItemsMoveAbove({ workspaceId, itemId: edit.itemId, dependentItemId: edit.dependentItemId });
  }
}

/**
 * Runs Runway row actions for one workspace, one at a time: while one is
 * being written the next is refused, so each click is exactly one
 * transaction. The store's answer — the whole new order — replaces the cached
 * rows at once; a refusal leaves the order as the store has it (re-read) and
 * is reported in `error`. `preview`, when given, is shown until the answer
 * arrives (a dropped row should not jump back while the move is written).
 */
export function useRunwayEdit(workspaceId: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (edit: RunwayEdit, preview?: RunwayItem[]): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      const key = RUNWAY_ITEMS_QUERY_KEY(workspaceId);
      await queryClient.cancelQueries({ queryKey: key });
      if (preview) {
        const shown: RunwayItemsResult = { ok: true, items: preview };
        queryClient.setQueryData(key, shown);
      }
      let r: RunwayItemsResult;
      try {
        r = await send(workspaceId, edit);
      } catch (e) {
        r = { ok: false, error: String((e as { message?: unknown })?.message ?? e) };
      }
      if (r.ok) queryClient.setQueryData(key, r);
      else void queryClient.invalidateQueries({ queryKey: key });
      busy.current = false;
      if (mounted.current) {
        setPending(false);
        setError(r.ok ? null : r.error);
      }
      return r.ok;
    },
    [queryClient, workspaceId],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

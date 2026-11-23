// Each project's priority order for the Tracker priority sort (VERM-92, VERM-93),
// YouTrack and Jira alike.
//
// The sort ranks every ticket by its own project's order — project tickets
// and tickets added to the Runway from outside the workspace's projects alike
// — so the renderer asks for every project its tickets come from. Each order
// is read on the workspace's own connection (the one its Runway tickets are
// read on, never another credential), and nothing is written. A project whose
// read fails — or that the connection refuses to read — is left out, so its
// tickets rank as unknown rather than failing the whole sort.

import type { PriorityOrdersResult } from '../../shared/ipc';
import { isYouTrackShortName } from '../../shared/priority';

/** At most this many projects per call. */
export const MAX_PRIORITY_ORDER_PROJECTS = 100;

export type PriorityOrderConnection =
  | { ok: true; read: (projectShortName: string) => Promise<string[]> }
  | { ok: false; error: string };

export interface PriorityOrdersDeps {
  /** Opens the workspace's own connection for its tracker. */
  connection: (workspaceId: string) => Promise<PriorityOrderConnection>;
}

export function createPriorityOrders(deps: PriorityOrdersDeps) {
  return async (args: unknown): Promise<PriorityOrdersResult> => {
    const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
    if (typeof a.workspaceId !== 'string' || !a.workspaceId) return { ok: false, error: 'A workspace is required.' };
    // YouTrack sends project short names, Jira project keys.
    const requested = a.projectShortNames ?? a.projectKeys;
    if (!Array.isArray(requested)) return { ok: false, error: 'Project names are required.' };
    const names = [...new Set(requested.filter(isYouTrackShortName))];
    if (names.length > MAX_PRIORITY_ORDER_PROJECTS) return { ok: false, error: 'Too many projects.' };
    if (names.length === 0) return { ok: true, orders: {} };

    const conn = await deps.connection(a.workspaceId);
    if (!conn.ok) return { ok: false, error: conn.error };
    const reads = await Promise.all(names.map((n) => conn.read(n).then((o) => o, () => null)));
    const orders: Record<string, string[]> = {};
    names.forEach((n, i) => {
      const order = reads[i];
      if (order) orders[n] = order;
    });
    return { ok: true, orders };
  };
}

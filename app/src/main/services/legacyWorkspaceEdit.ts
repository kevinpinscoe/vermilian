// Adding or removing one workspace under legacy storage, for the Markdown
// import's Apply and its cleanup (VERM-104). Electron-free, so it runs under
// vitest; main/ipc.ts supplies the reads and writes.
//
// Only the one workspace ID is added or removed: every other workspace, and
// every project assignment, is written back exactly as read. Unlike the rail's
// save, nothing is pruned against the projects the tracker shows now, so a
// project the credential cannot currently see keeps its assignment.
//
// The shared configuration is updated first, because it can refuse (while
// per-workspace storage is being activated). Only once it has accepted is
// the local file written; if that write fails, the shared update is put back.
// A refusal therefore leaves the local configuration exactly as it was.
//
// Putting it back reverses only this edit, against the configuration as it is
// then — re-read, never the copy taken before — so an unrelated edit made
// while the local write was in progress (a rename elsewhere) is kept.

import type { VermilianConfig, Workspace } from '../../shared/workspace';

export interface LegacyWorkspaceEditDeps {
  /** The current legacy configuration (the shared Article, else the local file). */
  read(): Promise<VermilianConfig | null>;
  /** Updates the shared configuration's cache; false when it refuses. */
  updateShared(config: VermilianConfig): boolean;
  /** Writes the local configuration file. */
  writeLocal(config: VermilianConfig): Promise<void>;
  /** Schedules the shared configuration's write to the tracker. */
  scheduleShared(): void;
  /** The message for a refusal. */
  refusedMessage: string;
}

/**
 * mayRemain: the shared configuration took the edit and could not be put
 * back, so the edit may have survived — the caller must keep the workspace's
 * ID to reconcile it.
 */
export type LegacyEditResult = { ok: true } | { ok: false; error: string; mayRemain?: true };

type Edit = (config: VermilianConfig) => VermilianConfig;

/** Writes `edit` applied to `before`; on a failed local write, applies `undo` to the latest shared configuration. */
async function write(deps: LegacyWorkspaceEditDeps, before: VermilianConfig, edit: Edit, undo: Edit): Promise<LegacyEditResult> {
  const next = edit(before);
  if (!deps.updateShared(next)) return { ok: false, error: deps.refusedMessage };
  try {
    await deps.writeLocal(next);
  } catch (err) {
    const message = (err as { message?: unknown } | null)?.message;
    const failed = `The workspace configuration could not be saved: ${typeof message === 'string' ? message : 'unknown error'}`;
    const latest = await deps.read().catch(() => null);
    if (!latest || !deps.updateShared(undo(latest))) {
      return { ok: false, error: `${failed}. The shared configuration could not be put back; reload the workspaces and check them.`, mayRemain: true };
    }
    // Another edit may already have sent the shared configuration with this change in it.
    deps.scheduleShared();
    return { ok: false, error: failed };
  }
  deps.scheduleShared();
  return { ok: true };
}

/** Adds `workspace` at the end; nothing else changes. */
export async function addLegacyWorkspace(deps: LegacyWorkspaceEditDeps, workspace: Workspace): Promise<LegacyEditResult> {
  const before = await deps.read();
  if (!before) return { ok: false, error: 'The workspace configuration could not be read.' };
  if (before.workspaces.some((w) => w.id === workspace.id)) return { ok: false, error: `A workspace ${workspace.id} already exists.` };
  return write(
    deps,
    before,
    (c) => ({ ...c, workspaces: [...c.workspaces, workspace] }),
    (c) => ({ ...c, workspaces: c.workspaces.filter((w) => w.id !== workspace.id) }),
  );
}

/** Removes the workspace `workspaceId`; nothing else changes. Already gone is success. */
export async function removeLegacyWorkspace(deps: LegacyWorkspaceEditDeps, workspaceId: string): Promise<LegacyEditResult> {
  const before = await deps.read();
  if (!before) return { ok: false, error: 'The workspace configuration could not be read.' };
  const index = before.workspaces.findIndex((w) => w.id === workspaceId);
  if (index < 0) return { ok: true };
  const removed = before.workspaces[index];
  return write(
    deps,
    before,
    (c) => ({ ...c, workspaces: c.workspaces.filter((w) => w.id !== workspaceId) }),
    // Back at its place, unless it has reappeared meanwhile.
    (c) => (c.workspaces.some((w) => w.id === workspaceId) ? c : { ...c, workspaces: [...c.workspaces.slice(0, index), removed, ...c.workspaces.slice(index)] }),
  );
}

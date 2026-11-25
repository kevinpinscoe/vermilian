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

export type LegacyEditResult = { ok: true } | { ok: false; error: string };

async function write(deps: LegacyWorkspaceEditDeps, before: VermilianConfig, next: VermilianConfig): Promise<LegacyEditResult> {
  if (!deps.updateShared(next)) return { ok: false, error: deps.refusedMessage };
  try {
    await deps.writeLocal(next);
  } catch (err) {
    deps.updateShared(before);
    const message = (err as { message?: unknown } | null)?.message;
    return { ok: false, error: `The workspace configuration could not be saved: ${typeof message === 'string' ? message : 'unknown error'}` };
  }
  deps.scheduleShared();
  return { ok: true };
}

/** Adds `workspace` at the end; nothing else changes. */
export async function addLegacyWorkspace(deps: LegacyWorkspaceEditDeps, workspace: Workspace): Promise<LegacyEditResult> {
  const before = await deps.read();
  if (!before) return { ok: false, error: 'The workspace configuration could not be read.' };
  if (before.workspaces.some((w) => w.id === workspace.id)) return { ok: false, error: `A workspace ${workspace.id} already exists.` };
  return write(deps, before, { ...before, workspaces: [...before.workspaces, workspace] });
}

/** Removes the workspace `workspaceId`; nothing else changes. Already gone is success. */
export async function removeLegacyWorkspace(deps: LegacyWorkspaceEditDeps, workspaceId: string): Promise<LegacyEditResult> {
  const before = await deps.read();
  if (!before) return { ok: false, error: 'The workspace configuration could not be read.' };
  if (!before.workspaces.some((w) => w.id === workspaceId)) return { ok: true };
  return write(deps, before, { ...before, workspaces: before.workspaces.filter((w) => w.id !== workspaceId) });
}

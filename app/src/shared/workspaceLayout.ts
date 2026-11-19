// The rail's layout edit (a VermilianConfig: names, order, folders and their
// projects) turned into per-workspace article writes (VERM-53, responsibility
// 9). Under per-workspace storage each workspace is its own article, so one
// layout save becomes one merge-and-verify update per workspace that changed.
//
// New workspaces are not created here: the rail creates them as their own
// articles with an explicit backend (VERM-33). A layout save never removes a
// workspace, so a stale layout cannot delete one by omission: deleting is its
// own confirmed operation, planned by planWorkspaceDelete (VERM-72).
//
// Pure TypeScript: no Electron, no React.

import { setWorkspaceProjects, type VermilianConfig } from './workspace';
import type { WorkspaceArticleEntry } from './workspaceArticle';
import type { WorkspaceDocument } from './workspaceSchema';
import { stableStringify } from './workspaceMerge';

export type LayoutWritePlan =
  | { ok: true; writes: Array<{ base: WorkspaceDocument; edited: WorkspaceDocument }> }
  | { ok: false; error: string };

export function planLayoutWrites(config: VermilianConfig, existing: ReadonlyMap<string, WorkspaceArticleEntry>): LayoutWritePlan {
  const inConfig = new Set(config.workspaces.map((w) => w.id));
  for (const [id, entry] of existing) {
    if (!inConfig.has(id)) {
      const name = entry.status === 'ok' ? `"${entry.document.name}"` : id;
      return {
        ok: false,
        error: `Workspace ${name} cannot be removed from the rail while per-workspace storage is active. Nothing was saved. Its configuration article was kept.`,
      };
    }
  }
  const writes: Array<{ base: WorkspaceDocument; edited: WorkspaceDocument }> = [];
  for (const ws of config.workspaces) {
    const entry = existing.get(ws.id);
    if (!entry) return { ok: false, error: `Workspace ${ws.id} has no configuration article. Nothing was saved.` };
    if (entry.status !== 'ok') return { ok: false, error: entry.message };
    const base = entry.document;
    const edited: WorkspaceDocument = { ...base, name: ws.name, order: ws.order, folders: ws.folders };
    if (stableStringify(edited) !== stableStringify(base)) writes.push({ base, edited });
  }
  return { ok: true, writes };
}

export type WorkspaceDeletePlan =
  | {
      ok: true;
      // Written before the delete, so a failure can never lose the projects.
      destinationWrite: { base: WorkspaceDocument; edited: WorkspaceDocument } | null;
      // The article version this plan was made from.
      expectedUpdated: number;
    }
  | { ok: false; error: string };

const backendAddress = (d: WorkspaceDocument) =>
  (d.backend.kind === 'youtrack' ? d.backend.serverUrl : d.backend.siteUrl).replace(/\/+$/, '');

/** Check a workspace can be deleted and work out where its projects go. */
export function planWorkspaceDelete(
  workspaceId: string,
  destinationId: string | null,
  existing: ReadonlyMap<string, WorkspaceArticleEntry>,
  newFolderId: string,
): WorkspaceDeletePlan {
  const target = existing.get(workspaceId);
  if (!target) return { ok: false, error: `Workspace ${workspaceId} has no configuration article. Nothing was deleted.` };
  if (target.status !== 'ok') return { ok: false, error: target.message };
  const hasAnother = [...existing.values()].some((e) => e.workspaceId !== workspaceId && e.status === 'ok');
  if (!hasAnother) return { ok: false, error: 'At least one workspace must exist. Nothing was deleted.' };

  const source = target.document;
  const expectedUpdated = target.updated;
  if (destinationId === null) return { ok: true, destinationWrite: null, expectedUpdated };

  const entry = existing.get(destinationId);
  if (destinationId === workspaceId || !entry) {
    return { ok: false, error: 'The workspace chosen for its projects is not available. Nothing was deleted.' };
  }
  if (entry.status !== 'ok') return { ok: false, error: entry.message };
  const base = entry.document;
  if (base.backend.kind !== source.backend.kind || backendAddress(base) !== backendAddress(source)) {
    return {
      ok: false,
      error: `"${base.name}" uses a different server, so it cannot hold the projects from "${source.name}". Nothing was deleted.`,
    };
  }

  const moving = source.folders.flatMap((f) => f.projectIds);
  if (moving.length === 0) return { ok: true, destinationWrite: null, expectedUpdated };

  const current = base.folders.flatMap((f) => f.projectIds);
  const moved = setWorkspaceProjects(
    { version: 1, activeWorkspaceId: base.workspaceId, workspaces: [{ id: base.workspaceId, name: base.name, order: base.order, folders: base.folders }] },
    base.workspaceId,
    [...current, ...moving.filter((id) => !current.includes(id))],
    newFolderId,
  );
  // Board settings follow their project; the destination's own settings win.
  const boards = Object.fromEntries(Object.entries(source.boards).filter(([id]) => moving.includes(id)));
  const edited: WorkspaceDocument = {
    ...base,
    folders: moved.workspaces[0].folders,
    boards: { ...boards, ...base.boards },
  };
  return { ok: true, destinationWrite: { base, edited }, expectedUpdated };
}

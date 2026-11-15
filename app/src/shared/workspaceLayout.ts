// The rail's layout edit (a VermilianConfig: names, order, folders and their
// projects) turned into per-workspace article writes (VERM-53, responsibility
// 9). Under per-workspace storage each workspace is its own article, so one
// layout save becomes one merge-and-verify update per workspace that changed.
//
// New workspaces are not created here: the rail creates them as their own
// articles with an explicit backend (VERM-33). Removing a workspace is
// refused: its article is configuration that only a person should delete.
//
// Pure TypeScript: no Electron, no React.

import type { VermilianConfig } from './workspace';
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

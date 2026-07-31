// Workspace configuration types — shared between main and renderer.
// VermilianConfig is cached in userData/workspace-config.json (local, offline-safe)
// and synced to the _vermilian-config YouTrack Article (see services/articleConfig.ts).

import { FIELD_DEFS, type BoardIssueFields } from './fields';
export type { BoardIssueFields };

export interface WorkspaceFolder {
  id: string;
  name: string;
  order: number;
  parentId: string | null; // always null in MVP (nested folders deferred)
  projectIds: string[];
}

export interface Workspace {
  id: string;
  name: string;
  order: number;
  folders: WorkspaceFolder[];
}

export interface VermilianConfig {
  version: 1;
  workspaces: Workspace[];
  activeWorkspaceId: string;
}

// YouTrack project as returned by /api/admin/projects.
export interface YouTrackProject {
  id: string;
  name: string;
  shortName: string;
}

// BoardIssueFields (the per-issue custom-field snapshot used by both the
// board and the detail panel) is now derived from FIELD_DEFS — see
// shared/fields.ts. notes and dateTimeEntered are null in the board query
// (not requested) and populated by the detail query.

// Known dropdown values, re-exported from FIELD_DEFS for the existing import
// sites (TaskForm, WorkspaceBoard, grouping, TaskDetailPanel, KanbanView,
// ProjectBoard) — unchanged shape, still `as const` string tuples.
export const STATUS_OPTIONS = FIELD_DEFS.status.options;
export const PRIORITY_OPTIONS = FIELD_DEFS.priority.options;
export const CATEGORY_OPTIONS = FIELD_DEFS.category.options;

export interface BoardIssue {
  id: string;
  idReadable: string;
  summary: string;
  resolved: number | null; // epoch ms; null = unresolved
  fields: BoardIssueFields;
}

export interface IssueDetailProject {
  id: string;
  name: string;
  shortName: string;
}

export interface IssueDetail extends BoardIssue {
  project: IssueDetailProject;
}

/** Build a fresh config that places all known projects in a single default workspace. */
export function makeInitialConfig(projectIds: string[]): VermilianConfig {
  return {
    version: 1,
    workspaces: [
      {
        id: 'workspace-default',
        name: 'Workspace',
        order: 0,
        folders: [
          {
            id: 'folder-unassigned',
            name: 'Unassigned',
            order: 0,
            parentId: null,
            projectIds,
          },
        ],
      },
    ],
    activeWorkspaceId: 'workspace-default',
  };
}

/** Return every project ID that appears in any folder across all workspaces. */
export function allAssignedProjectIds(config: VermilianConfig): Set<string> {
  const ids = new Set<string>();
  for (const ws of config.workspaces) {
    for (const folder of ws.folders) {
      for (const id of folder.projectIds) ids.add(id);
    }
  }
  return ids;
}

/**
 * Set the exact set of projects that belong to `workspaceId`.
 *
 * Membership is exclusive — a project lives in one workspace at a time — so
 * every id in `projectIds` is first stripped from all other workspaces. Ids
 * currently in the target but absent from `projectIds` are dropped from it and
 * become unassigned (they are never deleted from the config outright).
 *
 * A project already in the target keeps the folder it is in; only newly added
 * ids are appended to the first folder in display order, or to a fresh
 * `newFolderId` folder when the workspace has none (the empty-workspace case).
 */
export function setWorkspaceProjects(
  config: VermilianConfig,
  workspaceId: string,
  projectIds: readonly string[],
  newFolderId = 'folder-projects',
): VermilianConfig {
  const desired = new Set(projectIds);

  const workspaces = config.workspaces.map((ws) => {
    if (ws.id !== workspaceId) {
      // Exclusive membership: give up anything the target now claims.
      return {
        ...ws,
        folders: ws.folders.map((f) => ({
          ...f,
          projectIds: f.projectIds.filter((id) => !desired.has(id)),
        })),
      };
    }

    // Target: drop deselected ids, leave everything else where the user put it.
    const folders = ws.folders.map((f) => ({
      ...f,
      projectIds: f.projectIds.filter((id) => desired.has(id)),
    }));
    const alreadyHere = new Set(folders.flatMap((f) => f.projectIds));
    const added = projectIds.filter((id) => !alreadyHere.has(id));
    if (added.length === 0) return { ...ws, folders };

    if (folders.length === 0) {
      return {
        ...ws,
        folders: [{
          id: newFolderId,
          name: 'Projects',
          order: 0,
          parentId: null,
          projectIds: [...added],
        }],
      };
    }

    const firstId = folders.slice().sort((a, b) => a.order - b.order)[0].id;
    return {
      ...ws,
      folders: folders.map((f) =>
        f.id === firstId ? { ...f, projectIds: [...f.projectIds, ...added] } : f,
      ),
    };
  });

  return { ...config, workspaces };
}

/**
 * Drop project ids that no longer exist (e.g. left behind by a YouTrack
 * rebuild, which reassigns project ids even when names/short names are
 * unchanged) from every folder. Self-heals a config that would otherwise
 * leave a folder — or an entire workspace, if it was the only folder —
 * permanently empty.
 */
export function pruneStaleProjectIds(
  config: VermilianConfig,
  liveProjectIds: ReadonlySet<string>,
): VermilianConfig {
  return {
    ...config,
    workspaces: config.workspaces.map((ws) => ({
      ...ws,
      folders: ws.folders.map((folder) => ({
        ...folder,
        projectIds: folder.projectIds.filter((id) => liveProjectIds.has(id)),
      })),
    })),
  };
}

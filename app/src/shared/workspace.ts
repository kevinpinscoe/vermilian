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

// Native YouTrack Epic → Subtask issue-link metadata, resolved server-side in
// api/youtrack.ts (see rawToBoardIssue). Deliberately not a BoardIssueFields /
// FIELD_DEFS entry — this is issue-link data, not a custom field, and carries
// no `patchIssue` path (VERM-7: read-only Epic context).
export interface ParentEpic {
  id: string;
  idReadable: string;
  summary: string;
}

export interface BoardIssue {
  id: string;
  idReadable: string;
  summary: string;
  resolved: number | null; // epoch ms; null = unresolved
  fields: BoardIssueFields;
  parentEpic: ParentEpic | null;
  // This issue's own Type is "Epic" — read from the issue's Type custom
  // field server-side (main/api/youtrack.ts). An Epic is a container, never
  // itself a Choose-next candidate (VERM-7 review finding, 2026-09-16).
  isEpic: boolean;
  // What the status means, independent of its name. Set for Jira issues,
  // whose status names are per-project workflow names (VERM-31,
  // shared/jiraProjectSettings.ts); absent for YouTrack, whose shared status
  // vocabulary the board reads by name.
  statusRole?: StatusRole | null;
  // When the issue was last updated, epoch ms. Set for Jira issues (from
  // Jira's `updated`; null when Jira gave none or an unparseable one), so a
  // poll can tell which of two copies is newer (VERM-39, shared/jiraPoll.ts);
  // absent for YouTrack.
  updated?: number | null;
}

/** What a status means to Vermilian, whatever the workflow calls it. */
export type StatusRole = 'todo' | 'inProgress' | 'waiting' | 'blocked' | 'deferred' | 'done';

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

/**
 * Narrow a project list to those whose name or short name contains `query`,
 * ignoring case and surrounding whitespace. A blank query returns the list
 * unchanged. Order is preserved, so a filtered picker keeps the rail's order.
 */
export function filterProjects(projects: YouTrackProject[], query: string): YouTrackProject[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.shortName.toLowerCase().includes(q),
  );
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

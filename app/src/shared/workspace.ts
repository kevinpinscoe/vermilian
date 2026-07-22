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

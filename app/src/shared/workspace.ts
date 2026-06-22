// Workspace configuration types — shared between main and renderer.
// VermilianConfig is cached in userData/workspace-config.json (local, offline-safe)
// and synced to the _vermilian-config YouTrack Article (see services/articleConfig.ts).

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

// Per-issue custom-field snapshot used by both the board and the detail panel.
// notes and dateTimeEntered are null in the board query (not requested) and
// populated by the detail query.
export interface BoardIssueFields {
  status: string | null;
  priority: string | null;
  category: string | null;
  dueDate: number | null; // epoch ms
  ticket: string | null;
  ticketLink: string | null;
  trackingLink: string | null;
  notes: string | null;
  dateTimeEntered: number | null; // epoch ms
  assignee: string | null; // YouTrack login of the assignee (SingleUserIssueCustomField)
}

// Known dropdown values (hardcoded; match the hosted YouTrack instance).
export const STATUS_OPTIONS = [
  'To do', 'In Progress', 'Working on it', 'Waiting for IT', 'BLOCKED',
  'Waiting for approval', 'Waiting for customer', 'Waiting on external resource', 'Done',
] as const;

export const PRIORITY_OPTIONS = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor'] as const;

export const CATEGORY_OPTIONS = ['INBOX', 'BUG', 'FEATURE', 'TASK'] as const;

// Mapping from our field keys to YouTrack API field descriptors.
export const FIELD_TYPE_MAP: Record<
  string,
  { ytName: string; $type: string; kind: 'enum' | 'state' | 'date' | 'text' }
> = {
  status: { ytName: 'Status', $type: 'StateIssueCustomField', kind: 'state' },
  priority: { ytName: 'Priority', $type: 'SingleEnumIssueCustomField', kind: 'enum' },
  category: { ytName: 'Category', $type: 'SingleEnumIssueCustomField', kind: 'enum' },
  dueDate: { ytName: 'Due Date', $type: 'DateIssueCustomField', kind: 'date' },
  ticket: { ytName: 'Ticket', $type: 'SimpleIssueCustomField', kind: 'text' },
  ticketLink: { ytName: 'Ticket link', $type: 'SimpleIssueCustomField', kind: 'text' },
  trackingLink: { ytName: 'Tracking link', $type: 'SimpleIssueCustomField', kind: 'text' },
  notes: { ytName: 'Notes', $type: 'TextIssueCustomField', kind: 'text' },
  dateTimeEntered: { ytName: 'Date time entered', $type: 'DateIssueCustomField', kind: 'date' },
};

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

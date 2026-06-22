// Board configuration types — stored in the _vermilian-config YouTrack Article.

import type { VermilianConfig } from './workspace';

// ─── Column ───────────────────────────────────────────────────────────────────

export const ALL_COLUMN_FIELDS = [
  'summary',
  'status',
  'priority',
  'category',
  'dueDate',
  'ticket',
  'ticketLink',
  'trackingLink',
  'notes',
  'dateTimeEntered',
] as const;

export type ColumnField = (typeof ALL_COLUMN_FIELDS)[number];

export const COLUMN_LABELS: Record<ColumnField, string> = {
  summary: 'Summary',
  status: 'Status',
  priority: 'Priority',
  category: 'Category',
  dueDate: 'Due Date',
  ticket: 'Ticket #',
  ticketLink: 'Ticket link',
  trackingLink: 'Tracking link',
  notes: 'Notes',
  dateTimeEntered: 'Date entered',
};

export interface BoardColumnConfig {
  field: ColumnField;
  width: number;
  visible: boolean;
}

// ─── View ─────────────────────────────────────────────────────────────────────

export interface BoardSortConfig {
  field: ColumnField;
  direction: 'asc' | 'desc';
}

export interface BoardViewConfig {
  id: string;
  name: string;
  type: 'table' | 'kanban';
  groupBy: string; // field name or 'None'
  columns: BoardColumnConfig[];
  sort?: BoardSortConfig;
  issueOrderByGroup?: Record<string, string[]>; // group label → ordered issue IDs (manual reorder)
}

// ─── Board ────────────────────────────────────────────────────────────────────

// Per-board colour overrides: fieldName → (enumValue → hex colour).
// Merges on top of the default colour maps in colors.ts.
export type BoardColors = Record<string, Record<string, string>>;

export interface BoardConfig {
  boardId: string; // YouTrack project ID
  views: BoardViewConfig[];
  activeViewId: string;
  colors: BoardColors;
}

// ─── Article-level document ───────────────────────────────────────────────────

export const ARTICLE_CONFIG_VERSION = 1;

export interface ArticleFullConfig {
  version: number;
  workspaces: VermilianConfig['workspaces'];
  activeWorkspaceId: string;
  boards: Record<string, BoardConfig>; // keyed by project ID
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_COLUMNS: BoardColumnConfig[] = [
  { field: 'summary',         width: 320, visible: true  },
  { field: 'status',          width: 130, visible: true  },
  { field: 'priority',        width: 110, visible: true  },
  { field: 'category',        width: 110, visible: true  },
  { field: 'dueDate',         width: 110, visible: true  },
  { field: 'ticket',          width: 100, visible: true  },
  { field: 'ticketLink',      width: 120, visible: false },
  { field: 'trackingLink',    width: 120, visible: false },
  { field: 'notes',           width: 200, visible: false },
  { field: 'dateTimeEntered', width: 150, visible: false },
];

export function defaultBoardView(): BoardViewConfig {
  return {
    id: 'main-table',
    name: 'Main table',
    type: 'table',
    groupBy: 'Status',
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
  };
}

export function defaultKanbanView(): BoardViewConfig {
  return {
    id: 'kanban',
    name: 'Kanban',
    type: 'kanban',
    groupBy: 'Status',
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
  };
}

export function defaultBoardConfig(boardId: string): BoardConfig {
  return {
    boardId,
    views: [defaultBoardView(), defaultKanbanView()],
    activeViewId: 'main-table',
    colors: {},
  };
}

export function emptyArticleConfig(): ArticleFullConfig {
  return {
    version: ARTICLE_CONFIG_VERSION,
    workspaces: [],
    activeWorkspaceId: '',
    boards: {},
  };
}

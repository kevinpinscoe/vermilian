import { describe, it, expect } from 'vitest';
import {
  ALL_COLUMN_FIELDS,
  COLUMN_LABELS,
  DEFAULT_COLUMNS,
  defaultBoardView,
  defaultKanbanView,
  defaultBoardConfig,
  emptyArticleConfig,
  ARTICLE_CONFIG_VERSION,
} from './boardConfig';

describe('column metadata', () => {
  it('has a label for every known column field', () => {
    for (const field of ALL_COLUMN_FIELDS) {
      expect(COLUMN_LABELS[field]).toBeTruthy();
    }
  });

  it('DEFAULT_COLUMNS lists every field exactly once, summary first and visible', () => {
    const fields = DEFAULT_COLUMNS.map((c) => c.field);
    expect([...fields].sort()).toEqual([...ALL_COLUMN_FIELDS].sort());
    expect(fields[0]).toBe('summary');
    expect(DEFAULT_COLUMNS.find((c) => c.field === 'summary')?.visible).toBe(true);
  });
});

describe('defaultBoardView / defaultKanbanView', () => {
  it('builds the main table view', () => {
    const v = defaultBoardView();
    expect(v).toMatchObject({ id: 'main-table', name: 'Main table', type: 'table', groupBy: 'Status' });
    expect(v.columns).toHaveLength(DEFAULT_COLUMNS.length);
  });

  it('builds the kanban view', () => {
    const v = defaultKanbanView();
    expect(v).toMatchObject({ id: 'kanban', type: 'kanban', groupBy: 'Status' });
  });

  it('clones columns so views do not share column objects', () => {
    const a = defaultBoardView();
    const b = defaultBoardView();
    a.columns[0].width = 999;
    expect(b.columns[0].width).not.toBe(999);
    // and the module-level DEFAULT_COLUMNS is untouched
    expect(DEFAULT_COLUMNS[0].width).not.toBe(999);
  });
});

describe('defaultBoardConfig', () => {
  it('contains a table and a kanban view with the table active', () => {
    const cfg = defaultBoardConfig('proj-1');
    expect(cfg.boardId).toBe('proj-1');
    expect(cfg.views.map((v) => v.id)).toEqual(['main-table', 'kanban']);
    expect(cfg.activeViewId).toBe('main-table');
    expect(cfg.colors).toEqual({});
  });

  it('returns independent configs across calls', () => {
    const a = defaultBoardConfig('p');
    const b = defaultBoardConfig('p');
    a.views[0].columns[1].visible = false;
    expect(b.views[0].columns[1].visible).toBe(true);
  });
});

describe('emptyArticleConfig', () => {
  it('is versioned and empty', () => {
    expect(emptyArticleConfig()).toEqual({
      version: ARTICLE_CONFIG_VERSION,
      workspaces: [],
      activeWorkspaceId: '',
      boards: {},
    });
  });
});

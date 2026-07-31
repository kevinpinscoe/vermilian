import { describe, it, expect } from 'vitest';
import {
  makeInitialConfig,
  allAssignedProjectIds,
  pruneStaleProjectIds,
  type VermilianConfig,
} from './workspace';

describe('makeInitialConfig', () => {
  it('places every project in a single Unassigned folder of a default workspace', () => {
    const cfg = makeInitialConfig(['p1', 'p2', 'p3']);
    expect(cfg.version).toBe(1);
    expect(cfg.activeWorkspaceId).toBe('workspace-default');
    expect(cfg.workspaces).toHaveLength(1);

    const ws = cfg.workspaces[0];
    expect(ws.id).toBe('workspace-default');
    expect(ws.folders).toHaveLength(1);
    expect(ws.folders[0].id).toBe('folder-unassigned');
    expect(ws.folders[0].projectIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('handles an empty project list', () => {
    const cfg = makeInitialConfig([]);
    expect(cfg.workspaces[0].folders[0].projectIds).toEqual([]);
  });
});

describe('allAssignedProjectIds', () => {
  it('collects unique ids across folders and workspaces', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [
        {
          id: 'a',
          name: 'A',
          order: 0,
          folders: [
            { id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['p1', 'p2'] },
            { id: 'f2', name: 'F2', order: 1, parentId: null, projectIds: ['p2', 'p3'] },
          ],
        },
        {
          id: 'b',
          name: 'B',
          order: 1,
          folders: [{ id: 'f3', name: 'F3', order: 0, parentId: null, projectIds: ['p3', 'p4'] }],
        },
      ],
    };
    const ids = allAssignedProjectIds(cfg);
    expect(ids).toEqual(new Set(['p1', 'p2', 'p3', 'p4']));
  });

  it('returns an empty set for a config with no folders', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [{ id: 'a', name: 'A', order: 0, folders: [] }],
    };
    expect(allAssignedProjectIds(cfg).size).toBe(0);
  });
});

describe('pruneStaleProjectIds', () => {
  it('drops project ids not present in the live set, keeping live ones', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [
        {
          id: 'a',
          name: 'A',
          order: 0,
          folders: [
            { id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['live-1', 'dead-1'] },
          ],
        },
      ],
    };
    const pruned = pruneStaleProjectIds(cfg, new Set(['live-1', 'live-2']));
    expect(pruned.workspaces[0].folders[0].projectIds).toEqual(['live-1']);
  });

  it('can reduce a folder to empty without dropping the folder itself', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [
        {
          id: 'a',
          name: 'A',
          order: 0,
          folders: [{ id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['dead-1'] }],
        },
      ],
    };
    const pruned = pruneStaleProjectIds(cfg, new Set());
    expect(pruned.workspaces[0].folders[0].projectIds).toEqual([]);
    expect(pruned.workspaces[0].folders).toHaveLength(1);
  });

  it('prunes independently across multiple workspaces and folders', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [
        {
          id: 'a',
          name: 'A',
          order: 0,
          folders: [
            { id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['live-1', 'dead-1'] },
            { id: 'f2', name: 'F2', order: 1, parentId: null, projectIds: ['dead-2'] },
          ],
        },
        {
          id: 'b',
          name: 'B',
          order: 1,
          folders: [{ id: 'f3', name: 'F3', order: 0, parentId: null, projectIds: ['live-2'] }],
        },
      ],
    };
    const pruned = pruneStaleProjectIds(cfg, new Set(['live-1', 'live-2']));
    expect(pruned.workspaces[0].folders[0].projectIds).toEqual(['live-1']);
    expect(pruned.workspaces[0].folders[1].projectIds).toEqual([]);
    expect(pruned.workspaces[1].folders[0].projectIds).toEqual(['live-2']);
  });

  it('does not mutate the input config', () => {
    const cfg: VermilianConfig = {
      version: 1,
      activeWorkspaceId: 'a',
      workspaces: [
        {
          id: 'a',
          name: 'A',
          order: 0,
          folders: [{ id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['dead-1'] }],
        },
      ],
    };
    pruneStaleProjectIds(cfg, new Set());
    expect(cfg.workspaces[0].folders[0].projectIds).toEqual(['dead-1']);
  });
});

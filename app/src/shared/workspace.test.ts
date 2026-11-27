import { describe, it, expect } from 'vitest';
import {
  makeInitialConfig,
  allAssignedProjectIds,
  filterProjects,
  pruneStaleProjectIds,
  setWorkspaceProjects,
  type VermilianConfig,
  type YouTrackProject,
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

describe('setWorkspaceProjects', () => {
  function cfg(): VermilianConfig {
    return {
      version: 1,
      activeWorkspaceId: 'empty',
      workspaces: [
        {
          id: 'default', name: 'Workspace', order: 0,
          folders: [
            { id: 'f1', name: 'F1', order: 0, parentId: null, projectIds: ['p1', 'p2'] },
            { id: 'f2', name: 'F2', order: 1, parentId: null, projectIds: ['p3'] },
          ],
        },
        { id: 'work', name: 'Work', order: 1, folders: [
          { id: 'f3', name: 'F3', order: 0, parentId: null, projectIds: ['p4'] },
        ] },
        { id: 'empty', name: 'Kevin', order: 2, folders: [] },
      ],
    };
  }
  const folderOf = (c: VermilianConfig, wsId: string) =>
    c.workspaces.find((w) => w.id === wsId)!.folders;

  it('creates a Projects folder when adding to a workspace with no folders', () => {
    const next = setWorkspaceProjects(cfg(), 'empty', ['p1', 'p4'], 'folder-new');
    expect(folderOf(next, 'empty')).toEqual([
      { id: 'folder-new', name: 'Projects', order: 0, parentId: null, projectIds: ['p1', 'p4'] },
    ]);
  });

  it('strips the moved projects from every other workspace', () => {
    const next = setWorkspaceProjects(cfg(), 'empty', ['p1', 'p4'], 'folder-new');
    expect(folderOf(next, 'default').map((f) => f.projectIds)).toEqual([['p2'], ['p3']]);
    expect(folderOf(next, 'work')[0].projectIds).toEqual([]);
  });

  it('deselecting removes from the target but keeps the project in the config as unassigned', () => {
    const added = setWorkspaceProjects(cfg(), 'empty', ['p1'], 'folder-new');
    const removed = setWorkspaceProjects(added, 'empty', []);
    expect(folderOf(removed, 'empty')[0].projectIds).toEqual([]);
    expect(allAssignedProjectIds(removed).has('p1')).toBe(false);
  });

  it('appends new ids to the first folder by order, not by array position', () => {
    const base = cfg();
    // Reverse the array so display order (f1) differs from array order (f2).
    base.workspaces[0].folders.reverse();
    const next = setWorkspaceProjects(base, 'default', ['p1', 'p2', 'p3', 'p4']);
    const f1 = folderOf(next, 'default').find((f) => f.id === 'f1')!;
    expect(f1.projectIds).toEqual(['p1', 'p2', 'p4']);
  });

  it('leaves an already-present project in its existing folder', () => {
    const next = setWorkspaceProjects(cfg(), 'default', ['p1', 'p2', 'p3']);
    expect(folderOf(next, 'default').find((f) => f.id === 'f2')!.projectIds).toEqual(['p3']);
  });

  it('is a no-op on the folder set when nothing changes', () => {
    const next = setWorkspaceProjects(cfg(), 'work', ['p4']);
    expect(folderOf(next, 'work')).toEqual(folderOf(cfg(), 'work'));
  });
});

describe('filterProjects', () => {
  const projects: YouTrackProject[] = [
    { id: '1', name: 'Test Project', shortName: 'TEST' },
    { id: '2', name: 'Team Inbox', shortName: 'TMIB' },
    { id: '3', name: 'Empty Project', shortName: 'EMP' },
  ];
  const ids = (list: YouTrackProject[]) => list.map((p) => p.id);

  it('returns every project, in order, for an empty or blank query', () => {
    expect(ids(filterProjects(projects, ''))).toEqual(['1', '2', '3']);
    expect(ids(filterProjects(projects, '   '))).toEqual(['1', '2', '3']);
  });

  it('matches a substring of the name, ignoring case', () => {
    expect(ids(filterProjects(projects, 'project'))).toEqual(['1', '3']);
    expect(ids(filterProjects(projects, 'INBOX'))).toEqual(['2']);
  });

  it('matches a substring of the short name, ignoring case', () => {
    // "tmib" appears in no project name, so only the short name can match it.
    expect(ids(filterProjects(projects, 'tmib'))).toEqual(['2']);
  });

  it('trims surrounding whitespace from the query', () => {
    expect(ids(filterProjects(projects, '  inbox '))).toEqual(['2']);
  });

  it('returns nothing when no project matches', () => {
    expect(filterProjects(projects, 'zzz')).toEqual([]);
  });

  // VERM-120: a project whose long name is a prefix of others ("Kevin" beside
  // "Kevin - PIM") must surface first when its short name is typed.
  describe('ranking by short name', () => {
    const kevin: YouTrackProject[] = [
      { id: 'a', name: 'ideation', shortName: 'IDEA' },
      { id: 'b', name: 'Kevin - Personal data', shortName: 'KPD' },
      { id: 'c', name: 'Kevin - PIM', shortName: 'PIM' },
      { id: 'd', name: 'Kevin', shortName: 'KEVIN' },
      { id: 'e', name: 'Kevin - Physical security', shortName: 'KPS' },
    ];

    it('puts an exact short-name match first, ignoring case', () => {
      expect(ids(filterProjects(kevin, 'kevin'))).toEqual(['d', 'b', 'c', 'e']);
      expect(ids(filterProjects(kevin, ' KEVIN '))).toEqual(['d', 'b', 'c', 'e']);
    });

    it('ranks short-name prefix matches ahead of other matches', () => {
      // "kp" prefixes KPD and KPS; nothing else contains it.
      expect(ids(filterProjects(kevin, 'kp'))).toEqual(['b', 'e']);
      // "k" prefixes the keys KPD, KEVIN and KPS; "Kevin - PIM" matches only
      // through its name, so it comes after them.
      expect(ids(filterProjects(kevin, 'k'))).toEqual(['b', 'd', 'e', 'c']);
    });

    it('keeps the original order within each rank', () => {
      // "e" is no key's prefix and every row contains it, so the list is the
      // input order unchanged.
      expect(ids(filterProjects(kevin, 'e'))).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('does not reorder for an empty query', () => {
      expect(ids(filterProjects(kevin, ''))).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('does not mutate its input', () => {
      const copy = kevin.map((p) => ({ ...p }));
      filterProjects(kevin, 'kevin');
      expect(kevin).toEqual(copy);
    });
  });
});

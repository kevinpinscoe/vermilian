import { create } from 'zustand';

// Rail-collapse and per-folder expand/collapse are per-machine UI state, persisted
// to localStorage (NOT the _vermilian-config Article — that syncs across machines).
const RAIL_KEY = 'vermilian:rail-collapsed';
const FOLDERS_KEY = 'vermilian:expanded-folders';

function loadRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
}
function saveRail(v: boolean): void {
  try { localStorage.setItem(RAIL_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}
// Returns null when nothing was ever persisted, so the caller can distinguish a
// first launch (auto-expand all) from a user who deliberately collapsed everything.
function loadExpanded(): Set<string> | null {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (raw === null) return null;
    return new Set(JSON.parse(raw) as string[]);
  } catch { return null; }
}
function saveExpanded(s: Set<string>): void {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

interface WorkspaceState {
  activeWorkspaceId: string;
  activeProjectShortName: string | null; // shortName used for issue queries
  activeProjectId: string | null; // YouTrack project ID
  selectedIssueId: string | null; // issue open in the detail panel
  railCollapsed: boolean;
  expandedFolderIds: Set<string>;
  expandedHydrated: boolean; // true once expand state came from storage or a user action

  setActiveWorkspace(id: string): void;
  setActiveProject(projectId: string | null, shortName: string | null): void;
  setSelectedIssue(id: string | null): void;
  toggleRail(): void;
  toggleFolder(folderId: string): void;
  expandFolder(folderId: string): void;
}

const persistedExpanded = loadExpanded();

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: '',
  activeProjectShortName: null,
  activeProjectId: null,
  selectedIssueId: null,
  railCollapsed: loadRail(),
  expandedFolderIds: persistedExpanded ?? new Set<string>(),
  expandedHydrated: persistedExpanded !== null,

  setActiveWorkspace(id) {
    set({ activeWorkspaceId: id, activeProjectId: null, activeProjectShortName: null, selectedIssueId: null });
  },

  setActiveProject(projectId, shortName) {
    set({ activeProjectId: projectId, activeProjectShortName: shortName, selectedIssueId: null });
  },

  setSelectedIssue(id) {
    set({ selectedIssueId: id });
  },

  toggleRail() {
    set((s) => {
      const next = !s.railCollapsed;
      saveRail(next);
      return { railCollapsed: next };
    });
  },

  toggleFolder(folderId) {
    set((s) => {
      const next = new Set(s.expandedFolderIds);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      saveExpanded(next);
      return { expandedFolderIds: next, expandedHydrated: true };
    });
  },

  expandFolder(folderId) {
    set((s) => {
      if (s.expandedFolderIds.has(folderId)) return s;
      const next = new Set(s.expandedFolderIds);
      next.add(folderId);
      saveExpanded(next);
      return { expandedFolderIds: next, expandedHydrated: true };
    });
  },
}));

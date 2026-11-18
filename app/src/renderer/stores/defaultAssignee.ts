import { create } from 'zustand';

// Which workspace is showing all assignees (VERM-68). Held in memory only, so
// the next launch returns to the Default assignee.
interface DefaultAssigneeState {
  showAllFor: string | null;
  setShowAllFor(workspaceId: string | null): void;
}

export const useDefaultAssigneeStore = create<DefaultAssigneeState>((set) => ({
  showAllFor: null,
  setShowAllFor: (showAllFor) => set({ showAllFor }),
}));

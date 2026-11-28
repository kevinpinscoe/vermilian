import { create } from 'zustand';

// Editors holding changes the user has not submitted yet (VERM-123). An editor
// registers while it is dirty, through useUnsavedDraft; quitting asks about
// every registered draft and can save each through its own `save`.

export interface UnsavedDraft {
  label: string;
  /** Submits the draft. Resolves false (or throws) when it was not saved. */
  save: () => Promise<boolean> | boolean;
}

interface UnsavedStore {
  drafts: Record<string, UnsavedDraft>;
  register(id: string, draft: UnsavedDraft): void;
  unregister(id: string): void;
}

export const useUnsavedStore = create<UnsavedStore>((set) => ({
  drafts: {},
  register(id, draft) {
    set((s) => ({ drafts: { ...s.drafts, [id]: draft } }));
  },
  unregister(id) {
    set((s) => {
      if (!(id in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[id];
      return { drafts };
    });
  },
}));

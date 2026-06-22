import { create } from 'zustand';
import type { ThemeSetting } from '../../shared/config';

interface ThemeState {
  setting: ThemeSetting;
  // Load the persisted value into the store (no write-back).
  init: (s: ThemeSetting) => void;
  // User changed the theme: update + persist (applies immediately, no Save).
  setSetting: (s: ThemeSetting) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  setting: 'system',
  init: (s) => set({ setting: s }),
  setSetting: (s) => {
    set({ setting: s });
    void window.vermilian.saveConfig({ theme: s });
  },
}));

// Maps the setting to the Vibe theme class applied on the app root.
export function resolveThemeClass(setting: ThemeSetting): string {
  const dark =
    setting === 'dark' ||
    (setting === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 'dark-app-theme' : 'light-app-theme';
}

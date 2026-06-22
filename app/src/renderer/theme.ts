// Central theme palette. Values are injected as a <style> tag appended to the
// end of <head> so they always win the cascade regardless of what Vibe injects.
//
// LIGHT_PALETTE is intentionally minimal: it overrides only the handful of tokens
// that needed pinning for the light theme, and lets Vibe's own light tokens drive
// everything else (so light mode is unchanged).
//
// DARK_PALETTE is comprehensive: it defines a dark value for EVERY CSS custom
// property the app's CSS modules consume. Because our <style> is appended last,
// these win over Vibe's dark tokens for the listed properties, and Vibe's dark
// theme (activated by the .dark-app-theme class) styles its own components.
// Add new token overrides here — they propagate to every CSS module that
// references the corresponding var().

type ThemePalette = Record<string, string>;

export const LIGHT_PALETTE: ThemePalette = {
  '--primary-text-color': '#111111',
  '--secondary-text-color': '#444444',
  '--primary-text-on-secondary-color': '#111111',
  '--secondary-text-on-secondary-color': '#444444',
  '--nav-primary-text-color': '#111111',
  '--nav-secondary-text-color': '#444444',
  '--nav-header-text-color': '#111111',
  '--nav-background-color': '#f3f4f6',
  '--board-background-color': '#ffffff',
};

export const DARK_PALETTE: ThemePalette = {
  // Text
  '--primary-text-color': '#e6e9f0',
  '--secondary-text-color': '#9aa4b6',
  '--primary-text-on-secondary-color': '#e6e9f0',
  '--secondary-text-on-secondary-color': '#9aa4b6',
  '--text-color-on-primary': '#ffffff',
  // Navigation rail
  '--nav-primary-text-color': '#d4d9e3',
  '--nav-secondary-text-color': '#98a1b3',
  '--nav-header-text-color': '#e6e9f0',
  '--nav-background-color': '#161d2b',
  // Surfaces (deepest → most elevated)
  '--surface-app-background-color': '#11151e',
  '--allgrey-background-color': '#161d2b',
  '--board-background-color': '#1b2430',
  '--surface-main-background-color': '#1b2430',
  '--secondary-background-color': '#1b2430',
  '--primary-background-color': '#232c3b',
  '--dialog-background-color': '#232c3b',
  // Borders
  '--border-color': '#2c3546',
  '--border-color-light': '#242c3a',
  '--ui-border-color': '#313b4e',
  // Accents / interaction
  '--primary-color': '#5b9bff',
  '--primary-hover-color': 'rgba(255, 255, 255, 0.06)',
  '--primary-selected-color': 'rgba(91, 155, 255, 0.18)',
  '--negative-color': '#ff5d6c',
  '--negative-color-selected': 'rgba(255, 93, 108, 0.16)',
  '--positive-color': '#33d18a',
  '--positive-color-selected': 'rgba(51, 209, 138, 0.16)',
  '--warning-color-selected': 'rgba(253, 171, 61, 0.16)',
};

export function paletteFor(themeClass: string): ThemePalette {
  return themeClass === 'dark-app-theme' ? DARK_PALETTE : LIGHT_PALETTE;
}

const STYLE_TAG_ID = 'vermilian-theme-overrides';

export function applyPalette(themeClass: string): void {
  const palette = paletteFor(themeClass);
  const vars = Object.entries(palette).map(([k, v]) => `${k}: ${v};`).join(' ');
  // Use the same class selector Vibe uses (.light-app-theme / .dark-app-theme)
  // so specificity matches (0,1,0). Being last in <head> wins the tie.
  const css = `.${themeClass} { ${vars} }`;
  let el = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_TAG_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

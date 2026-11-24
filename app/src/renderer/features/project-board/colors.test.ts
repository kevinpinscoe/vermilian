import { describe, it, expect } from 'vitest';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS, getContrastColor } from './colors';

const DARK = '#323338';
const LIGHT = '#ffffff';

describe('getContrastColor', () => {
  it('returns dark text on a light background', () => {
    expect(getContrastColor('#FFFFFF')).toBe(DARK);
    expect(getContrastColor('#FFCB00')).toBe(DARK); // bright yellow
  });

  it('returns light text on a dark background', () => {
    expect(getContrastColor('#000000')).toBe(LIGHT);
    expect(getContrastColor('#00C875')).toBe(LIGHT); // monday green
    expect(getContrastColor('#E2445C')).toBe(LIGHT); // monday red
  });

  it('returns one of exactly the two contrast tokens', () => {
    for (const hex of Object.values({ ...STATUS_COLORS, ...PRIORITY_COLORS, ...CATEGORY_COLORS })) {
      expect([DARK, LIGHT]).toContain(getContrastColor(hex));
    }
  });
});

describe('colour maps', () => {
  // Colours are a cosmetic name-to-colour default; a value with none falls back
  // to grey, so the maps no longer have to cover a fixed value list (VERM-117).
  it('defines a valid colour for each priority it names, including the shared bundle\'s', () => {
    for (const p of ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor']) expect(PRIORITY_COLORS[p]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    for (const c of Object.values(PRIORITY_COLORS)) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('defines a valid colour for each category it names', () => {
    for (const c of Object.values(CATEGORY_COLORS)) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('uses 6-digit hex for every status colour', () => {
    for (const hex of Object.values(STATUS_COLORS)) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

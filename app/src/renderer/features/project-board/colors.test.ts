import { describe, it, expect } from 'vitest';
import { STATUS_COLORS, PRIORITY_COLORS, CATEGORY_COLORS, getContrastColor } from './colors';
import { PRIORITY_OPTIONS, CATEGORY_OPTIONS } from '../../../shared/workspace';

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
  it('defines a colour for every priority option', () => {
    for (const p of PRIORITY_OPTIONS) expect(PRIORITY_COLORS[p]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('defines a colour for every category option', () => {
    for (const c of CATEGORY_OPTIONS) expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('uses 6-digit hex for every status colour', () => {
    for (const hex of Object.values(STATUS_COLORS)) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

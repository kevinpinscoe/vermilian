import { describe, expect, it } from 'vitest';
import { popoverPlacement } from './popoverPlacement';

const viewport = { width: 1200, height: 800 };

describe('popoverPlacement (VERM-90)', () => {
  it('opens below its cell when there is room', () => {
    expect(popoverPlacement({ top: 100, bottom: 122, left: 40 }, 150, viewport)).toEqual({ placement: 'below', top: 126, left: 40 });
  });

  it('opens above a bottom-row cell, anchored by its bottom edge just over the cell', () => {
    expect(popoverPlacement({ top: 740, bottom: 762, left: 40 }, 150, viewport)).toEqual({ placement: 'above', bottom: 64, left: 40 });
  });

  it('stays below when it fits nowhere but there is more room below', () => {
    expect(popoverPlacement({ top: 100, bottom: 122, left: 40 }, 900, viewport).placement).toBe('below');
  });

  it('is kept inside the window horizontally', () => {
    expect(popoverPlacement({ top: 100, bottom: 122, left: 1100 }, 150, viewport).left).toBe(1200 - 300 - 8);
    expect(popoverPlacement({ top: 100, bottom: 122, left: 2 }, 150, viewport).left).toBe(8);
  });
});

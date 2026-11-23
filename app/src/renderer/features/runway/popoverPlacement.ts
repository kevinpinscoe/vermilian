// Where the All tasks Runway # popover goes (VERM-90). Pure, for vitest.

export const POPOVER_WIDTH = 300;
const GAP = 4;
const MARGIN = 8;

/**
 * Where the popover goes: below its cell, or above it when it does not fit
 * below and there is more room above (a bottom row), so its controls stay on
 * screen. Kept inside the window horizontally.
 */
export function popoverPlacement(
  cell: { top: number; bottom: number; left: number },
  popoverHeight: number,
  viewport: { width: number; height: number },
  width = POPOVER_WIDTH,
): { placement: 'below' | 'above'; top?: number; bottom?: number; left: number } {
  const left = Math.max(MARGIN, Math.min(cell.left, viewport.width - width - MARGIN));
  const roomBelow = viewport.height - cell.bottom - GAP - MARGIN;
  const roomAbove = cell.top - GAP - MARGIN;
  if (popoverHeight > roomBelow && roomAbove > roomBelow) {
    // Anchored by its bottom edge, so a taller popover (a prompt, an error)
    // grows upward and never covers its cell.
    return { placement: 'above', bottom: viewport.height - cell.top + GAP, left };
  }
  return { placement: 'below', top: cell.bottom + GAP, left };
}

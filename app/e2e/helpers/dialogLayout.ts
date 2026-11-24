// The dialog layout check (VERM-116, generalised for VERM-118): a dialog's
// heading must sit inside the dialog with real clearance from its edges, clear
// of the close button, and the dialog's action buttons must lie wholly inside
// it.
//
// "Heading box inside dialog box" alone would pass on the broken layout,
// because an inset of 0 still counts as inside — the VERM-116 defect was a
// heading flush against the corner. So this measures clearance. Action
// buttons are scrolled into view first: one at the end of long content must be
// reachable and unclipped, not visible without scrolling.

import fs from 'fs';
import { expect, test, type Locator } from '@playwright/test';

// ModalBasicLayout gives 32px above the heading and the modal's inline padding
// on the left; 16px allows for theme and font differences while still failing
// a flush (0px) layout.
export const MIN_INSET = 16;

type Box = { x: number; y: number; width: number; height: number };

export interface DialogLayoutMeasurement {
  headingTopGapPx: number;
  headingLeftGapPx: number;
  headingInsideDialog: boolean;
  headingOverlapsCloseButton: boolean;
  /** Each named action button: whether it lies wholly inside the dialog. */
  buttons: Record<string, boolean>;
  /**
   * Notices (role alert or status, e.g. Vibe's AttentionBox) that run past the
   * dialog's content column — the content-box overflow VERM-109 and VERM-118 found.
   */
  noticesOutsideContent: number;
}

const inside = (t: Box, d: Box) => t.x >= d.x && t.y >= d.y && t.x + t.width <= d.x + d.width && t.y + t.height <= d.y + d.height;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The dialog's close button (Vibe's default test id carries the modal id as a suffix). */
export function closeButton(dialog: Locator): Locator {
  return dialog.locator('[data-testid^="modal-close-button"]').first();
}

/** Measure once; null while any element is not laid out yet. */
export async function measureDialogLayout(
  dialog: Locator,
  heading: Locator,
  buttons: Record<string, Locator>,
): Promise<DialogLayoutMeasurement | null> {
  const d = await dialog.boundingBox();
  const h = await heading.boundingBox();
  const c = await closeButton(dialog).boundingBox();
  if (!d || !h || !c) return null;
  const fit: Record<string, boolean> = {};
  for (const [name, loc] of Object.entries(buttons)) {
    // A button at the end of long, scrolling content is below the fold by
    // design; it must be reachable and not clipped, so scroll it into view.
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) return null;
    fit[name] = inside(b, d);
  }
  // Notices must stay inside the content column (Vibe's ModalContent). An
  // AttentionBox takes role alert or status by type; a custom data-testid
  // replaces its default one, so the roles are what find them all.
  let noticesOutsideContent = 0;
  const content = await dialog.locator('[data-testid^="modal-content"]').first().boundingBox();
  for (const n of await dialog.locator('[role="alert"], [role="status"]').all()) {
    if (!content || !(await n.isVisible())) continue;
    await n.scrollIntoViewIfNeeded().catch(() => {});
    const b = await n.boundingBox();
    const c = await dialog.locator('[data-testid^="modal-content"]').first().boundingBox();
    if (b && c && (b.x < c.x - 1 || b.x + b.width > c.x + c.width + 1)) noticesOutsideContent++;
  }
  return {
    noticesOutsideContent,
    headingTopGapPx: Math.round(h.y - d.y),
    headingLeftGapPx: Math.round(h.x - d.x),
    headingInsideDialog: inside(h, d),
    headingOverlapsCloseButton: overlaps(h, c),
    buttons: fit,
  };
}

// Let the dialog's open animation finish before a single measurement.
async function settle(dialog: Locator): Promise<void> {
  await dialog.page().waitForTimeout(800);
}

/** What is wrong with a measurement, or 'ok'. */
export function layoutProblems(m: DialogLayoutMeasurement | null): string {
  if (!m) return 'not measured';
  const problems: string[] = [];
  if (m.headingTopGapPx < MIN_INSET) problems.push(`top inset ${m.headingTopGapPx}px`);
  if (m.headingLeftGapPx < MIN_INSET) problems.push(`left inset ${m.headingLeftGapPx}px`);
  if (!m.headingInsideDialog) problems.push('heading extends past dialog');
  if (m.headingOverlapsCloseButton) problems.push('heading overlaps the close button');
  for (const [name, ok] of Object.entries(m.buttons)) if (!ok) problems.push(`${name} extends past dialog`);
  if (m.noticesOutsideContent > 0) problems.push(`${m.noticesOutsideContent} notice(s) run past the content column`);
  return problems.length ? problems.join('; ') : 'ok';
}

/**
 * Assert the layout, retrying while the dialog animates in. The last
 * measurement is attached to the test result and, when
 * DIALOG_LAYOUT_RECORD names a file, appended to it as one JSON line — so a
 * run on unchanged code yields the "before" values per dialog. With
 * DIALOG_LAYOUT_MEASURE_ONLY=1 it records without asserting, so a test that
 * opens several dialogs measures all of them on a layout that fails.
 */
export async function expectDialogLayout(
  name: string,
  dialog: Locator,
  heading: Locator,
  buttons: Record<string, Locator> = {},
): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(heading).toBeVisible();
  let last: DialogLayoutMeasurement | null = null;
  const measureOnly = process.env.DIALOG_LAYOUT_MEASURE_ONLY === '1';
  try {
    if (measureOnly) {
      await settle(dialog);
      await expect.poll(async () => (last = await measureDialogLayout(dialog, heading, buttons)) !== null).toBe(true);
      return;
    }
    await expect
      .poll(async () => {
        last = await measureDialogLayout(dialog, heading, buttons);
        return layoutProblems(last);
      }, { message: `${name} dialog layout` })
      .toBe('ok');
  } finally {
    const record = { dialog: name, problems: layoutProblems(last), ...(last ?? {}) };
    await test.info().attach(`layout-${name}`, { body: JSON.stringify(record, null, 1), contentType: 'application/json' });
    const file = process.env.DIALOG_LAYOUT_RECORD;
    if (file) fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  }
}

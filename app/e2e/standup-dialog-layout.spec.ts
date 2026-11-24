/**
 * Stand-Up dialog heading layout (VERM-116). The heading used to sit flush
 * against the dialog's top-left corner, clipped by the rounded edge, with the
 * close button pushed down over the content. That happened because
 * <ModalHeader> was placed straight inside <Modal>: in @vibe/core 4 the
 * header's spacing comes from <ModalBasicLayout>, not from <ModalHeader>.
 *
 * "Heading box inside dialog box" alone would pass on the broken layout,
 * because an inset of 0 still counts as inside. So this check measures real
 * clearance: a minimum inset from the dialog's top and left edges, and no
 * overlap with the close button. It also checks that the step's action buttons
 * lie wholly inside the dialog: the layout's padded full-width children once
 * overflowed the right edge and clipped Generate.
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

// ModalBasicLayout gives 32px above the heading and the modal's inline
// padding on the left; 16px leaves margin for theme or font differences while
// still failing the flush (0px) layout.
const MIN_INSET = 16;

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectHeadingClear(dialog: Locator, heading: Locator) {
  await expect(heading).toBeVisible();
  // Auto-retrying: the dialog animates in, so a single read can catch it mid-transition.
  await expect
    .poll(async () => {
      const d = await dialog.boundingBox();
      const h = await heading.boundingBox();
      const close = await dialog.locator('[data-testid^="modal-close-button"]').boundingBox();
      if (!d || !h || !close) return 'not measured';
      const problems: string[] = [];
      if (h.y - d.y < MIN_INSET) problems.push(`top inset ${Math.round(h.y - d.y)}px`);
      if (h.x - d.x < MIN_INSET) problems.push(`left inset ${Math.round(h.x - d.x)}px`);
      if (h.x + h.width > d.x + d.width || h.y + h.height > d.y + d.height) problems.push('heading extends past dialog');
      if (overlaps(h, close)) problems.push('heading overlaps the close button');
      return problems.length ? problems.join('; ') : 'ok';
    })
    .toBe('ok');
}

async function expectInsideDialog(dialog: Locator, target: Locator) {
  await expect(target).toBeVisible();
  await expect
    .poll(async () => {
      const d = await dialog.boundingBox();
      const t = await target.boundingBox();
      if (!d || !t) return 'not measured';
      const inside = t.x >= d.x && t.y >= d.y && t.x + t.width <= d.x + d.width && t.y + t.height <= d.y + d.height;
      return inside ? 'ok' : `extends past dialog (right edge ${Math.round(t.x + t.width - (d.x + d.width))}px over)`;
    })
    .toBe('ok');
}

test.describe('Stand-Up dialog heading layout (VERM-116)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="standup-btn"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('heading sits inside the dialog, clear of its edges, in the config and report steps', async () => {
    await page.locator('[data-testid="standup-btn"]').click();
    const dialog = page.locator('#standup-modal');
    await expect(dialog).toBeVisible();

    // Config step — and its workspace scoping line is unchanged (VERM-48).
    await expectHeadingClear(dialog, dialog.getByRole('heading', { name: 'Daily Stand-Up', exact: true }));
    await expectInsideDialog(dialog, page.locator('[data-testid="standup-generate-btn"]'));
    await expect(page.locator('[data-testid="standup-workspace"]')).toHaveText(
      /This stand-up covers .+ only\./,
    );

    // Report step.
    await page.locator('[data-testid="standup-generate-btn"]').click();
    await expect(page.locator('[data-testid="standup-report-body"]')).toBeVisible();
    await expectHeadingClear(dialog, dialog.getByRole('heading', { name: /^Daily Stand-Up — / }));
    await expectInsideDialog(dialog, dialog.getByRole('button', { name: 'Close', exact: true }));
  });
});

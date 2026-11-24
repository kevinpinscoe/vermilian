/**
 * Stand-Up dialog heading layout (VERM-116). The heading used to sit flush
 * against the dialog's top-left corner, clipped by the rounded edge, with the
 * close button pushed down over the content, because <ModalHeader> was placed
 * straight inside <Modal>: in @vibe/core 4 the header's spacing comes from
 * <ModalBasicLayout>. The check itself is the shared one every dialog uses
 * (helpers/dialogLayout.ts, VERM-118); dialog-layout.spec.ts covers the rest.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { expectDialogLayout } from './helpers/dialogLayout';
import type { ElectronApplication } from '@playwright/test';

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

    // Config step — and its workspace scoping line is unchanged (VERM-48).
    await expectDialogLayout('standup-config', dialog, dialog.getByRole('heading', { name: 'Daily Stand-Up', exact: true }), {
      Generate: page.locator('[data-testid="standup-generate-btn"]'),
    });
    await expect(page.locator('[data-testid="standup-workspace"]')).toHaveText(/This stand-up covers .+ only\./);

    // Report step.
    await page.locator('[data-testid="standup-generate-btn"]').click();
    await expect(page.locator('[data-testid="standup-report-body"]')).toBeVisible();
    await expectDialogLayout('standup-report', dialog, dialog.getByRole('heading', { name: /^Daily Stand-Up — / }), {
      Close: dialog.locator('button:not([data-testid^="modal-close-button"])').filter({ hasText: /^Close$/ }).first(),
    });
  });
});

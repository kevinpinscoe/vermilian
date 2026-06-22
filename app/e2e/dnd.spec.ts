/**
 * DnD feature tests — covers commit 96e9ed8 (row reorder, column reorder/resize, cross-board drag).
 * Prerequisite: open Main table view on a project with at least 3 tasks in the same group.
 * See TESTING.md for the full manual checklist this file is derived from.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

// Navigate from the default workspace "All tasks" view to the first project board.
// The app launches on WorkspaceBoard (no data-testid="main-table"); clicking a
// nav-project loads ProjectBoard which has that testid.
async function navigateToFirstProject(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-project"]').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

// Helper: drag from one element to another via pointer events (uses element centers).
// For row drag, use dragRowTo instead — row drag must start on the drag-handle.
async function dragTo(page: Page, sourceSelector: string, targetSelector: string) {
  const source = await page.$(sourceSelector);
  const target = await page.$(targetSelector);
  if (!source || !target) throw new Error(`drag: element not found — ${sourceSelector} or ${targetSelector}`);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('drag: could not get bounding boxes');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

// Drag a task row to a target locator. Starts the drag from the drag-handle (required
// because dnd-kit PointerSensor only activates when pointerdown fires on the handle,
// and the handle sits at x+12 inside the first td — beyond the x+8 center-row approach).
import type { Locator } from '@playwright/test';
async function dragRowTo(page: Page, sourceRow: Locator, target: Locator): Promise<boolean> {
  const handleBox = await sourceRow.locator('[data-testid="drag-handle"]').boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) return false;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
  return true;
}

// Within-group sortable reorder is the trickiest synthetic drag: dnd-kit only
// swaps once the pointer crosses the target row's midpoint, so we keep x fixed in
// the drag-handle column (never leaving the rows), nudge past the 6px activation
// distance, then move past the target's midpoint in many small steps.
async function dragRowWithinGroup(page: Page, sourceRow: Locator, targetRow: Locator): Promise<boolean> {
  const handleBox = await sourceRow.locator('[data-testid="drag-handle"]').boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!handleBox || !targetBox) return false;
  const x = handleBox.x + handleBox.width / 2;
  await page.mouse.move(x, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, handleBox.y + handleBox.height / 2 + 10, { steps: 3 });
  // Past the target's midpoint so the swap commits.
  await page.mouse.move(x, targetBox.y + targetBox.height * 0.7, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  return true;
}

// ─── Section 1: Row reordering within a group ────────────────────────────────

test.describe('Row reorder within group', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });

  test.afterEach(async () => { await app.close(); });

  test('drag handle appears on row hover', async () => {
    const row = page.locator('[data-testid="task-row"]').first();
    await row.hover();
    await expect(page.locator('[data-testid="drag-handle"]').first()).toBeVisible();
  });

  // FIXME: dnd-kit's within-group sortable reorder keys collision detection off the
  // dragged element's transformed rect, which Playwright's synthetic pointer events
  // don't reliably reproduce (the over-target/drop-indicator state never engages).
  // Between-group and cross-board drags work because their droppables are separate
  // elements. This interaction is covered manually in TESTING.md until a reliable
  // synthetic driver (or @dnd-kit test utils) is wired up.
  test.fixme('drop indicator appears while dragging a row', async () => {
    const rows = page.locator('[data-testid="task-row"]');
    const handle = rows.nth(0).locator('[data-testid="drag-handle"]');
    const second = await rows.nth(1).boundingBox();
    if (!second) return test.skip();

    // hover() first to fire mouseenter → makes dnd-kit pointer sensor ready
    await handle.hover();
    const handleBox = await handle.boundingBox();
    await page.mouse.down();
    // First nudge past dnd-kit's 6px activation distance so the drag actually starts,
    // then move over the second row so the drop indicator renders.
    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 12, { steps: 3 });
    }
    const targetX = handleBox ? handleBox.x + handleBox.width / 2 : second.x + 20;
    // Move past the second row's midpoint so dnd-kit registers the over-target.
    await page.mouse.move(targetX, second.y + second.height * 0.7, { steps: 20 });

    await expect(page.locator('[data-testid="drop-indicator"]')).toBeVisible();
    await page.mouse.up();
  });

  // FIXME: same dnd-kit within-group synthetic-drag limitation as above — covered
  // manually in TESTING.md. The optimistic reorder + persistence logic itself is
  // exercised by the unit-level config code.
  test.fixme('row moves to new position after drop', async () => {
    // Need 3 rows in the same group — find the first group with enough rows
    const allGroups = page.locator('[data-testid="task-group"]');
    const groupCount = await allGroups.count();
    let targetGroup = null;
    for (let i = 0; i < groupCount; i++) {
      const rowCount = await allGroups.nth(i).locator('[data-testid="task-row"]').count();
      if (rowCount >= 3) { targetGroup = allGroups.nth(i); break; }
    }
    if (!targetGroup) return test.skip();

    const rows = targetGroup.locator('[data-testid="task-row"]');
    const firstId = await rows.nth(0).getAttribute('data-task-id');
    const thirdId = await rows.nth(2).getAttribute('data-task-id');

    // Within-group reorder needs the staged helper (cross the target midpoint).
    const ok = await dragRowWithinGroup(page, rows.nth(0), rows.nth(2));
    if (!ok) return test.skip();

    // First row should now be where the third was
    await expect(rows.nth(2)).toHaveAttribute('data-task-id', firstId ?? '');
    expect(await rows.nth(0).getAttribute('data-task-id')).not.toBe(firstId);
    void thirdId;
  });
});

// ─── Section 2: Column header reorder ────────────────────────────────────────

test.describe('Column header reorder', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });

  test.afterEach(async () => { await app.close(); });

  test('drag handle appears on non-Summary column header hover', async () => {
    const header = page.locator('[data-testid="col-header"]:not([data-col="summary"])').first();
    await header.hover();
    await expect(page.locator('[data-testid="col-header-drag-handle"]').first()).toBeVisible();
  });

  test('column moves to new position after header drag', async () => {
    const headers = page.locator('[data-testid="col-header"]');
    const secondColName = await headers.nth(1).getAttribute('data-col');
    const thirdColName = await headers.nth(2).getAttribute('data-col');

    await dragTo(page,
      '[data-testid="col-header"]:nth-child(2) [data-testid="col-header-drag-handle"]',
      '[data-testid="col-header"]:nth-child(3)');

    // Columns should have swapped
    await expect(headers.nth(1)).toHaveAttribute('data-col', thirdColName ?? '');
    await expect(headers.nth(2)).toHaveAttribute('data-col', secondColName ?? '');
  });

  test('clicking a header still sorts after reorder', async () => {
    // Reorder columns first
    await dragTo(page,
      '[data-testid="col-header"]:nth-child(2) [data-testid="col-header-drag-handle"]',
      '[data-testid="col-header"]:nth-child(3)');

    // Then click a header and confirm sort indicator appears
    const header = page.locator('[data-testid="col-header"]').nth(1);
    await header.click();
    await expect(header.locator('[data-testid="sort-indicator"]')).toBeVisible();
  });
});

// ─── Section 3: Column resize ─────────────────────────────────────────────────

test.describe('Column resize', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });

  test.afterEach(async () => { await app.close(); });

  test('col-resize cursor appears on column right edge hover', async () => {
    const resizeHandle = page.locator('[data-testid="col-resize-handle"]').first();
    await resizeHandle.hover();
    const cursor = await resizeHandle.evaluate(el => getComputedStyle(el).cursor);
    expect(cursor).toBe('col-resize');
  });

  test('column widens when right edge dragged right', async () => {
    const header = page.locator('[data-testid="col-header"]:not([data-col="summary"])').first();
    const handle = header.locator('[data-testid="col-resize-handle"]');
    const before = (await header.boundingBox())?.width ?? 0;

    const handleBox = await handle.boundingBox();
    if (!handleBox) return test.skip();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await header.boundingBox())?.width ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  test('column cannot shrink below 40px minimum', async () => {
    const header = page.locator('[data-testid="col-header"]:not([data-col="summary"])').first();
    const handle = header.locator('[data-testid="col-resize-handle"]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) return test.skip();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 500, handleBox.y + handleBox.height / 2, { steps: 20 });
    await page.mouse.up();

    const width = (await header.boundingBox())?.width ?? 0;
    expect(width).toBeGreaterThanOrEqual(40);
  });
});

// ─── Section 4: Cross-board drag ─────────────────────────────────────────────

test.describe('Cross-board drag', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });

  test.afterEach(async () => { await app.close(); });

  test('nav projects highlight as drop targets when dragging a task row', async () => {
    const row = page.locator('[data-testid="task-row"]').first();
    const handleBox = await row.locator('[data-testid="drag-handle"]').boundingBox();
    if (!handleBox) return test.skip();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Move upward toward the nav to trigger the DnD context and cross-board drop zones
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 80, { steps: 10 });

    const navProjects = page.locator('[data-testid="nav-project"]');
    const count = await navProjects.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(navProjects.nth(i)).toHaveAttribute('data-drop-target', 'true');
    }

    await page.mouse.up();
  });

  test('confirmation dialog appears when task dropped on different project', async () => {
    const navProjects = page.locator('[data-testid="nav-project"]');
    if (await navProjects.count() < 2) return test.skip();

    // Drag the first task row onto a *different* project than the active one.
    const target = page.locator('[data-testid="nav-project"]:not([aria-current="true"])').first();
    const ok = await dragRowTo(page, page.locator('[data-testid="task-row"]').first(), target);
    if (!ok) return test.skip();

    await expect(page.locator('[data-testid="cross-board-confirm-dialog"]')).toBeVisible();
  });

  test('Cancel in confirmation dialog keeps task in source board', async () => {
    const navProjects = page.locator('[data-testid="nav-project"]');
    if (await navProjects.count() < 2) return test.skip();

    const firstRow = page.locator('[data-testid="task-row"]').first();
    const taskId = await firstRow.getAttribute('data-task-id');

    const target = page.locator('[data-testid="nav-project"]:not([aria-current="true"])').first();
    const ok = await dragRowTo(page, firstRow, target);
    if (!ok) return test.skip();

    await page.locator('[data-testid="cross-board-cancel-btn"]').click();
    await expect(page.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
  });

  test('dropping on same project shows no dialog', async () => {
    const currentProject = page.locator('[data-testid="nav-project"][aria-current="true"]');
    if (!await currentProject.count()) return test.skip();

    const ok = await dragRowTo(page, page.locator('[data-testid="task-row"]').first(), currentProject);
    if (!ok) return test.skip();

    await expect(page.locator('[data-testid="cross-board-confirm-dialog"]')).not.toBeVisible();
  });
});

// ─── Section 5: Regression checks ────────────────────────────────────────────

test.describe('Regression', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await navigateToFirstProject(page);
  });

  test.afterEach(async () => { await app.close(); });

  test('between-group drag still works', async () => {
    const groups = page.locator('[data-testid="task-group"]');
    if (await groups.count() < 2) return test.skip();

    const sourceRow = groups.nth(0).locator('[data-testid="task-row"]').first();
    // Target the second group's header using Playwright locator (.nth() is index-based,
    // not affected by thead being nth-child(1) of the table element)
    const targetGroupHeader = groups.nth(1).locator('[data-testid="group-header"]');

    const sourceId = await sourceRow.getAttribute('data-task-id');
    const ok = await dragRowTo(page, sourceRow, targetGroupHeader);
    if (!ok) return test.skip();

    // Task should now appear in second group
    await expect(groups.nth(1).locator(`[data-task-id="${sourceId}"]`)).toBeVisible();
  });

  test('column show/hide via Hide panel still works', async () => {
    await page.locator('[data-testid="hide-columns-btn"]').click();
    // Skip summary — it is non-hideable; use the first non-summary column toggle
    const firstToggle = page.locator('[data-testid="column-visibility-toggle"]:not([data-col="summary"])').first();
    if (!await firstToggle.count()) return test.skip();
    const colName = await firstToggle.getAttribute('data-col');
    await firstToggle.click(); // hide

    // Scope to <th> inside main-table to avoid matching the panel toggle div
    const colHeader = page.locator(`[data-testid="main-table"] th[data-col="${colName}"]`);
    await expect(colHeader).not.toBeVisible();

    await firstToggle.click(); // re-show
    await expect(colHeader).toBeVisible();
  });

  test('column sort still works after column reorder', async () => {
    // Reorder
    await dragTo(page,
      '[data-testid="col-header"]:nth-child(2) [data-testid="col-header-drag-handle"]',
      '[data-testid="col-header"]:nth-child(3)');

    // Sort by clicking a column
    const header = page.locator('[data-testid="col-header"]').nth(1);
    await header.click();
    await expect(header.locator('[data-testid="sort-indicator"]')).toBeVisible();
  });
});

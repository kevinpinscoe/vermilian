/**
 * Adding projects to a workspace via the rail picker.
 *
 * A workspace holding no projects has no rail row to right-click, so the
 * "Move to workspace" context menu cannot reach it. The picker is the only
 * route in — this guards that route and the exclusive-membership rule.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function newWorkspace(page: Page, name: string) {
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.locator('[data-testid="new-workspace-btn"]').click();
  await page.locator('[data-testid="new-workspace-input"]').fill(name);
  await page.locator('[data-testid="new-workspace-submit"]').click();
  await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText(name);
}

async function switchTo(page: Page, name: string) {
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.locator(`[data-testid="workspace-menu-item"][data-ws-name="${name}"]`).click();
  await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText(name);
}

test.describe('Add projects to a workspace', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('an empty workspace offers the picker and lists every project with its origin', async () => {
    await newWorkspace(page, 'Kevin');

    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="add-projects-btn"]')).toBeVisible();

    await page.locator('[data-testid="add-projects-btn"]').click();
    // All four fake-YouTrack projects are offered, each showing where it lives now.
    await expect(page.locator('[data-testid="add-projects-row"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="add-projects-row"]').first()).toContainText('Workspace');
  });

  test('checking projects moves them into the workspace and out of the old one', async () => {
    await newWorkspace(page, 'Kevin');
    await page.locator('[data-testid="add-projects-btn"]').click();

    const rows = page.locator('[data-testid="add-projects-row"]');
    const firstName = await rows.first().getAttribute('data-project-name');
    const secondName = await rows.nth(1).getAttribute('data-project-name');
    await rows.first().locator('input').check();
    await rows.nth(1).locator('input').check();

    // Moving out of another workspace is called out before saving.
    await expect(page.locator('[data-testid="add-projects-move-notice"]')).toBeVisible();
    await page.locator('[data-testid="add-projects-save"]').click();

    // They now appear in "Kevin"...
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(2);
    await expect(page.locator(`[data-nav-project-name="${firstName}"]`)).toBeVisible();

    // ...and are gone from the workspace they came from.
    await switchTo(page, 'Workspace');
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(2);
    await expect(page.locator(`[data-nav-project-name="${secondName}"]`)).toHaveCount(0);
  });

  test('unchecking removes a project from the workspace without deleting it', async () => {
    await newWorkspace(page, 'Kevin');
    await page.locator('[data-testid="add-projects-btn"]').click();
    const rows = page.locator('[data-testid="add-projects-row"]');
    const moved = await rows.first().getAttribute('data-project-name');
    await rows.first().locator('input').check();
    await page.locator('[data-testid="add-projects-save"]').click();
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(1);

    // Uncheck it again — it leaves the workspace but survives as unassigned.
    await page.locator('[data-testid="add-projects-btn"]').click();
    await page.locator(`[data-testid="add-projects-row"][data-project-name="${moved}"] input`).uncheck();
    await page.locator('[data-testid="add-projects-save"]').click();

    await expect(page.locator('nav').getByText('Unassigned', { exact: true })).toBeVisible();
    await expect(page.locator(`[data-nav-project-name="${moved}"]`)).toBeVisible();
  });

  test('emptying a workspace leaves nothing to rehome when deleting it', async () => {
    await newWorkspace(page, 'Kevin');

    // Pull every project out of the default workspace into "Kevin".
    await page.locator('[data-testid="add-projects-btn"]').click();
    const boxes = page.locator('[data-testid="add-projects-row"] input');
    for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check();
    await page.locator('[data-testid="add-projects-save"]').click();
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(4);

    // "Workspace" is now empty, so the confirm step has no projects to rehome.
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="manage-workspaces-btn"]').click();
    await expect(
      page.locator('[data-testid="workspace-row"][data-ws-name="Workspace"]'),
    ).toContainText('0 projects');
    await page.locator('[data-testid="workspace-row"][data-ws-name="Workspace"] [data-testid="workspace-delete"]').click();
    await expect(page.locator('[data-testid="ws-delete-move"]')).toHaveCount(0);

    await page.locator('[data-testid="ws-delete-confirm-input"]').fill('Workspace');
    await page.locator('[data-testid="ws-delete-confirm"]').click();
    await expect(page.locator('[data-testid="workspace-row"]')).toHaveCount(1);
  });
});

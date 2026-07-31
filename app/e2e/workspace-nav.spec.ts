/**
 * Workspace navigation (bucket 1: create/rename folders, fresh-install banner,
 * Manage workspaces). Runs against the in-memory fake YouTrack (4 projects,
 * placed in a single "Unassigned" folder of a default "Workspace" on first run).
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

async function waitForNav(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
}

test.describe('Workspace navigation', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await waitForNav(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('fresh install shows the onboarding banner and all projects', async () => {
    await expect(page.locator('[data-testid="attention-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(4);
  });

  test('add folder creates a folder in the tree', async () => {
    await page.locator('[data-testid="add-folder-btn"]').click();
    await page.locator('[data-testid="add-folder-input"]').fill('Backlog');
    await page.locator('[data-testid="add-folder-input"]').press('Enter');
    await expect(page.locator('nav').getByText('Backlog', { exact: true })).toBeVisible();
  });

  test('create workspace switches the active workspace', async () => {
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="new-workspace-btn"]').click();
    await page.locator('[data-testid="new-workspace-input"]').fill('QA Space');
    await page.locator('[data-testid="new-workspace-submit"]').click();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('QA Space');
  });

  test('Manage workspaces deletes a workspace that still holds projects, rehoming them', async () => {
    // Create a second workspace so delete is not disabled by the "last workspace" rule.
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="new-workspace-btn"]').click();
    await page.locator('[data-testid="new-workspace-input"]').fill('Second');
    await page.locator('[data-testid="new-workspace-submit"]').click();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Second');

    // Open Manage workspaces.
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="manage-workspaces-btn"]').click();
    const rows = page.locator('[data-testid="workspace-row"]');
    await expect(rows).toHaveCount(2);

    // The original "Workspace" still holds all 4 projects. Deleting it is no longer
    // blocked — the confirm step asks where those projects should go.
    await page.locator('[data-testid="workspace-row"][data-ws-name="Workspace"] [data-testid="workspace-delete"]').click();
    await expect(page.locator('[data-testid="ws-delete-move"]')).toContainText('4 projects');

    await page.locator('[data-testid="ws-delete-destination"]').selectOption({ label: 'Second' });
    await page.locator('[data-testid="ws-delete-confirm-input"]').fill('Workspace');
    await page.locator('[data-testid="ws-delete-confirm"]').click();

    // "Workspace" is gone and its projects landed in "Second" rather than vanishing.
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-testid="workspace-row"][data-ws-name="Second"]')).toContainText('4 projects');
  });

  test('deleting a workspace can leave its projects unassigned instead', async () => {
    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="new-workspace-btn"]').click();
    await page.locator('[data-testid="new-workspace-input"]').fill('Second');
    await page.locator('[data-testid="new-workspace-submit"]').click();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Second');

    await page.locator('[data-testid="workspace-switcher"]').click();
    await page.locator('[data-testid="manage-workspaces-btn"]').click();
    await page.locator('[data-testid="workspace-row"][data-ws-name="Workspace"] [data-testid="workspace-delete"]').click();

    // "Unassigned" is the default destination — accept it.
    await page.locator('[data-testid="ws-delete-confirm-input"]').fill('Workspace');
    await page.locator('[data-testid="ws-delete-confirm"]').click();
    await page.locator('[data-testid="workspace-row"][data-ws-name="Second"]').waitFor();
    await expect(page.locator('[data-testid="workspace-row"][data-ws-name="Second"]')).toContainText('0 projects');

    // The projects still exist — the rail lists them under "Unassigned".
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('nav').getByText('Unassigned', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="nav-project"]')).toHaveCount(4);
  });
});

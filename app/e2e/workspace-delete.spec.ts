/**
 * Deleting a workspace under per-workspace storage (VERM-72), against the fake
 * YouTrack: the article is really deleted, projects can move first, a refused
 * delete changes nothing, and a refused layout save is shown to the user.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const youtrack: WorkspaceDocument['backend'] = { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' };

function wsDoc(workspaceId: string, name: string, order: number, backend: WorkspaceDocument['backend'], projectIds: string[]): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name,
    order,
    backend,
    ai: { credentialRef: null },
    folders: [{ id: `folder-${order}`, name: 'Projects', order: 0, parentId: null, projectIds }],
    boards: {},
    dismissals: {},
  };
}

const articleTitles = (page: Page) =>
  page.evaluate(async () => (await window.vermilian.debugGetWorkspaceArticles!()).map((a) => a.summary));

const row = (page: Page, name: string) => page.locator(`[data-testid="workspace-row"][data-ws-name="${name}"]`);

async function openManage(page: Page) {
  await page.locator('[data-testid="workspace-switcher"]').click();
  await page.locator('[data-testid="manage-workspaces-btn"]').click();
}

async function startDelete(page: Page, name: string) {
  await row(page, name).locator('[data-testid="workspace-delete"]').click();
  await page.locator('[data-testid="ws-delete-confirm-input"]').fill(name);
}

test.describe('Deleting a workspace — per-workspace storage', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const docs = [
      wsDoc('ws-e2edel1', 'Alpha', 0, youtrack, ['0-e1']),
      wsDoc('ws-e2edel2', 'Beta', 1, youtrack, []),
      wsDoc('ws-e2edel3', 'Gamma', 2, { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' }, ['DEMO']),
    ];
    for (const d of docs) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Alpha', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('deleting the active workspace moves its projects, removes its article and switches away', async () => {
    await openManage(page);
    await startDelete(page, 'Alpha');
    await page.locator('[data-testid="ws-delete-destination"]').selectOption({ label: 'Beta' });
    await page.locator('[data-testid="ws-delete-confirm"]').click();

    await expect(row(page, 'Alpha')).toHaveCount(0);
    await expect(row(page, 'Beta')).toContainText('1 project');
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Beta');
    await expect.poll(() => articleTitles(page)).not.toContain('_vermilian-ws-ws-e2edel1');
  });

  test('a refused delete keeps the workspace, stays on it and says why', async () => {
    await openManage(page);
    await startDelete(page, 'Alpha');
    await page.locator('[data-testid="ws-delete-destination"]').selectOption({ label: 'Gamma' });
    await page.locator('[data-testid="ws-delete-confirm"]').click();

    await expect(page.locator('[data-testid="ws-delete-error"]')).toContainText('different server');
    await expect(row(page, 'Alpha')).toHaveCount(1);
    await expect(page.locator('[data-testid="workspace-switcher"]')).toContainText('Alpha');
    expect(await articleTitles(page)).toContain('_vermilian-ws-ws-e2edel1');
  });

  test('a refused rename is shown instead of being dropped silently', async () => {
    await openManage(page);
    await page.evaluate(async () => {
      const articles = await window.vermilian.debugGetWorkspaceArticles!();
      const beta = articles.find((a) => a.summary === '_vermilian-ws-ws-e2edel2');
      await window.vermilian.debugWriteWorkspaceArticle!(beta!.id, '{ not json');
    });

    await row(page, 'Alpha').getByTitle('Click to rename').click();
    await row(page, 'Alpha').locator('input').fill('Renamed');
    await row(page, 'Alpha').locator('input').press('Enter');

    await expect(page.getByText(/cannot be used/)).toBeVisible();
  });
});

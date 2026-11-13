/**
 * Migration from _vermilian-config (and the Jira profile article) to
 * per-workspace articles (VERM-44), through the real IPC channels against the
 * fake YouTrack. Nothing in the app runs migration yet (VERM-46 runs it when
 * it activates per-workspace storage), so the spec drives the API directly —
 * and first checks that starting the app migrates nothing.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { defaultBoardConfig, dismissalKey } from '../src/shared/boardConfig';
import type { WorkspaceMigrationOptions, WorkspaceMigrationResult } from '../src/shared/workspaceMigration';

// Fictional values only.
const W1 = 'workspace-1700000000001';
const W2 = 'workspace-1700000000002';

const LEGACY = {
  version: 1,
  activeWorkspaceId: W1,
  workspaces: [
    { id: W1, name: 'Workspace A', order: 0, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }] },
    { id: W2, name: 'Workspace B', order: 1, folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e2'] }] },
  ],
  boards: { '0-e1': defaultBoardConfig('0-e1') },
  dismissals: { [dismissalKey(W2, '2-1')]: { workspace: W2, issueId: '2-1', dismissedWeekOf: '2026-11-09' } },
};

const JIRA = { version: 1, profile: { siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '' } };

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  return page;
}

const api = {
  plan: (page: Page, o?: WorkspaceMigrationOptions) =>
    page.evaluate((x) => window.vermilian.planWorkspaceMigration(x), o) as Promise<WorkspaceMigrationResult>,
  apply: (page: Page, o?: WorkspaceMigrationOptions) =>
    page.evaluate((x) => window.vermilian.applyWorkspaceMigration(x), o) as Promise<WorkspaceMigrationResult>,
  articles: (page: Page) => page.evaluate(() => window.vermilian.debugGetWorkspaceArticles!()),
  sources: (page: Page) => page.evaluate(() => window.vermilian.debugGetMigrationSources!()),
};

test.describe('Migration to per-workspace configuration articles', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('starting the app migrates nothing; plan writes nothing; apply migrates once and keeps the originals', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(LEGACY, null, 2),
      VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: JSON.stringify(JIRA, null, 2),
    });
    const page = await ready(app);

    // Startup: no workspace article appears.
    expect(await api.articles(page)).toEqual([]);
    const sources = await api.sources(page);
    expect(sources).toHaveLength(2);

    // Dry run.
    const plan = await api.plan(page);
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    expect(plan.items.map((i) => [i.workspaceId, i.action])).toEqual([
      [W1, 'create'],
      [W2, 'create'],
    ]);
    expect(plan.jiraProfile).toMatchObject({ status: 'unassigned' });
    expect(await api.articles(page)).toEqual([]);

    // Apply, with a name for the Jira workspace.
    const applied = await api.apply(page, { jiraWorkspaceName: 'Workspace J' });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    expect(applied.complete).toBe(true);
    expect(applied.jiraProfile).toMatchObject({ status: 'assigned' });
    expect(applied.items.map((i) => [i.backend, i.action])).toEqual([
      ['youtrack', 'created'],
      ['youtrack', 'created'],
      ['jira', 'created'],
    ]);
    const stored = (await api.articles(page)).map((a) => JSON.parse(a.content) as Record<string, unknown>);
    expect(stored).toHaveLength(3);
    expect(stored.find((d) => d.workspaceId === W2)).toMatchObject({
      name: 'Workspace B',
      backend: { kind: 'youtrack', credentialRef: 'youtrack-1' },
      ai: { credentialRef: 'anthropic-1' },
      dismissals: { [dismissalKey(W2, '2-1')]: { issueId: '2-1' } },
    });
    expect(stored.find((d) => (d.backend as { kind: string }).kind === 'jira')).toMatchObject({
      name: 'Workspace J',
      backend: { credentialRef: 'jira-1' },
      ai: { credentialRef: null },
      folders: [],
    });

    // Originals untouched; a second run changes nothing.
    expect(await api.sources(page)).toEqual(sources);
    const again = await api.apply(page, { jiraWorkspaceName: 'Workspace J' });
    expect(again).toMatchObject({ ok: true, complete: true });
    if (again.ok) expect(again.items.every((i) => i.action === 'unchanged')).toBe(true);
    expect(await api.articles(page)).toHaveLength(3);
    expect(await api.sources(page)).toEqual(sources);
  });
});

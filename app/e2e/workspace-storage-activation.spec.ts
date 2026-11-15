/**
 * Activation of per-workspace configuration storage (VERM-53), through the
 * packaged app against the fake YouTrack. Replaces the VERM-44 migration
 * spec: migration now runs only inside activation, which Settings starts
 * after an explicit confirmation.
 *
 * Covered: startup migrates nothing; the preview writes nothing; a full
 * activation (backup, migration, marker, local switch, sources untouched);
 * an incomplete migration and a credential that does not resolve both leave
 * _vermilian-config authoritative; a machine on legacy storage is blocked
 * once another machine activated; board settings and dismissals stay in their
 * own workspace; the return to legacy storage is refused after a change and
 * allowed without one; an older client's write is detected.
 *
 * Fictional values only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { defaultBoardConfig, dismissalKey } from '../src/shared/boardConfig';
import { STORAGE_MARKER_TITLE } from '../src/shared/storageActivation';
import { WORKSPACE_ARTICLE_PREFIX } from '../src/shared/workspaceArticle';

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

const SEED = {
  VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(LEGACY, null, 2),
  VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: JSON.stringify(JIRA, null, 2),
};

type Article = { id: string; summary: string; content: string; updated: number };

const api = {
  all: (page: Page) => page.evaluate(() => window.vermilian.debugGetWorkspaceArticles!()) as Promise<Article[]>,
  sources: (page: Page) => page.evaluate(() => window.vermilian.debugGetMigrationSources!()),
  status: (page: Page) => page.evaluate(() => window.vermilian.getStorageStatus()),
  activate: (page: Page, jiraWorkspaceName?: string) =>
    page.evaluate((n) => window.vermilian.activateWorkspaceStorage({ confirmed: true, ...(n ? { jiraWorkspaceName: n } : {}) }), jiraWorkspaceName),
  returnToLegacy: (page: Page) => page.evaluate(() => window.vermilian.returnToLegacyStorage({ confirmed: true })),
  write: (page: Page, id: string, content: string) =>
    page.evaluate(([i, c]) => window.vermilian.debugWriteWorkspaceArticle!(i, c), [id, content] as const),
};
const workspaceArticles = async (page: Page) => (await api.all(page)).filter((a) => a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX));
const markers = async (page: Page) => (await api.all(page)).filter((a) => a.summary === STORAGE_MARKER_TITLE);

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  return page;
}

test.describe('Per-workspace storage activation', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('startup migrates nothing; preview writes nothing; Settings activates after confirmation', async () => {
    const userData = freshUserDataDir();
    app = await launchAppWithUserDataDir(userData, SEED);
    const page = await ready(app);
    const sources = await api.sources(page);
    expect(await workspaceArticles(page)).toEqual([]);
    expect(await markers(page)).toEqual([]);
    expect((await api.status(page)).mode).toBe('legacy');
    expect(fs.existsSync(path.join(userData, 'workspace-storage.json'))).toBe(false);

    await page.locator('[data-testid="topbar-settings-btn"]').click();
    const section = page.getByTestId('storage-section');
    await expect(section.getByTestId('storage-summary')).toContainText('Shared configuration');
    await expect(section.getByTestId('storage-activate-btn')).toBeDisabled();

    await section.locator('input[data-testid="storage-jira-name"], [data-testid="storage-jira-name"] input').first().fill('Workspace J');
    await section.getByTestId('storage-preview-btn').click();
    await expect(section.getByTestId('storage-preview')).toContainText('Workspace A (youtrack): will be created');
    expect(await workspaceArticles(page)).toEqual([]);

    // Cancelling the confirmation does nothing.
    await section.getByTestId('storage-activate-btn').click();
    await page.getByTestId('storage-cancel-btn').click();
    expect(await markers(page)).toEqual([]);

    await section.getByTestId('storage-activate-btn').click();
    await page.getByTestId('storage-confirm-btn').click();
    await expect(section.getByTestId('storage-outcome')).toContainText('Per-workspace storage activated');
    await expect(section.getByTestId('storage-summary')).toContainText('Per-workspace storage since');

    // Three workspaces migrated, the marker is active, the sources are untouched.
    const docs = (await workspaceArticles(page)).map((a) => JSON.parse(a.content.replace(/^```json\n|\n```$/g, '')) as Record<string, unknown>);
    expect(docs.map((d) => d.name).sort()).toEqual(['Workspace A', 'Workspace B', 'Workspace J']);
    expect(docs.find((d) => d.workspaceId === W2)).toMatchObject({ dismissals: { [dismissalKey(W2, '2-1')]: { issueId: '2-1' } } });
    expect(await markers(page)).toHaveLength(1);
    expect(await api.sources(page)).toEqual(sources);

    // This machine's state and its private backup, on disk.
    const local = JSON.parse(fs.readFileSync(path.join(userData, 'workspace-storage.json'), 'utf8')) as { mode: string; backupFile: string };
    expect(local.mode).toBe('per-workspace');
    expect(path.dirname(local.backupFile)).toBe(path.join(userData, 'storage-activation-backups'));
    const backup = JSON.parse(fs.readFileSync(local.backupFile, 'utf8')) as { articles: Array<{ role: string; content: string }> };
    expect(backup.articles.map((a) => a.role)).toEqual(['config', 'jira-profile']);
    expect(JSON.parse(backup.articles[0].content)).toEqual(LEGACY);
    if (process.platform !== 'win32') expect(fs.statSync(local.backupFile).mode & 0o777).toBe(0o600);

    // A restart keeps the choice and still migrates nothing more.
    await app.close();
    app = await launchAppWithUserDataDir(userData, SEED);
    const again = await ready(app);
    expect((await api.status(again)).mode).toBe('per-workspace');
  });

  test('an incomplete migration leaves _vermilian-config authoritative and writes no marker', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      ...SEED,
      // An existing, unreadable article for Workspace B.
      VERMILIAN_E2E_WS_ARTICLES: JSON.stringify([{ summary: `${WORKSPACE_ARTICLE_PREFIX}${W2}`, content: 'not json' }]),
    });
    const page = await ready(app);
    const r = await api.activate(page);
    expect(r).toMatchObject({ ok: false, reason: 'migration-blocked' });
    expect(await markers(page)).toEqual([]);
    expect((await workspaceArticles(page)).map((a) => a.summary)).toEqual([`${WORKSPACE_ARTICLE_PREFIX}${W2}`]);
    expect(await api.status(page)).toMatchObject({ mode: 'legacy', guard: { allowed: true } });
  });

  test('on legacy storage the workspace-article write API is refused', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), SEED);
    const page = await ready(app);
    const doc = {
      schema: 1, workspaceId: W1, name: 'Workspace A', order: 0,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
      ai: { credentialRef: null }, folders: [], boards: {}, dismissals: {},
    };
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d as never), doc);
    expect(r).toMatchObject({ ok: false, reason: 'write-failed' });
    if (!r.ok) expect(r.message).toContain('old shared configuration');
    expect(await workspaceArticles(page)).toEqual([]);
  });

  test('a credential reference that does not resolve stops activation before anything is written', async () => {
    const userData = freshUserDataDir();
    fs.writeFileSync(
      path.join(userData, 'app-config.json'),
      JSON.stringify({ youtrackUrl: 'http://e2e.local', claudeKeyFile: path.join(userData, 'no-such-key-file') }),
    );
    app = await launchAppWithUserDataDir(userData, SEED);
    const page = await ready(app);
    const r = await api.activate(page);
    expect(r).toMatchObject({ ok: false, reason: 'credential-failed' });
    if (!r.ok) expect(r.message).toContain('anthropic-1');
    expect(await workspaceArticles(page)).toEqual([]);
    expect(await markers(page)).toEqual([]);
    expect((await api.status(page)).mode).toBe('legacy');
  });

  test('a machine on legacy storage is blocked once another machine activated, and saves nothing', async () => {
    const marker = {
      schema: 1, kind: 'vermilian-storage-activation', state: 'active', generation: 'gen-other-machine-0001', sequence: 1,
      activatedAt: '2026-11-15T12:00:00.000Z', retiredAt: null,
      sources: { config: { articleId: 'e2e-article', updated: 1 }, jiraProfile: null }, workspaces: {},
    };
    app = await launchAppWithUserDataDir(freshUserDataDir(), { ...SEED, VERMILIAN_E2E_STORAGE_MARKER: JSON.stringify(marker) });
    const page = await ready(app);
    expect((await api.status(page)).guard).toMatchObject({ allowed: false, reason: 'activated-elsewhere' });
    const before = await api.sources(page);

    // A board-settings save on this machine is refused, not written.
    await page.evaluate((b) => window.vermilian.saveBoardConfig(b), { ...defaultBoardConfig('0-e1'), colors: { status: { Open: '#123456' } } });
    await page.evaluate(() => window.vermilian.saveWorkspaceConfig({ version: 1, activeWorkspaceId: '', workspaces: [] }));
    await page.waitForTimeout(2_500); // past the 1.5 s debounce
    expect(await api.sources(page)).toEqual(before);

    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByTestId('storage-summary')).toContainText('not being saved');
    await expect(page.getByTestId('storage-activate-btn')).toContainText('Use per-workspace storage on this computer');
  });

  test('board settings and dismissals go to the active workspace only; return is refused after a change', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), SEED);
    const page = await ready(app);
    expect(await api.activate(page)).toMatchObject({ ok: true, outcome: 'activated' });
    await page.evaluate((id) => window.vermilian.setActiveWorkspace(id), W1);
    const byId = async () =>
      Object.fromEntries(
        (await workspaceArticles(page)).map((a) => {
          const d = JSON.parse(a.content.replace(/^```json\n|\n```$/g, '')) as { workspaceId: string; boards: Record<string, { colors?: unknown }>; dismissals: Record<string, unknown> };
          return [d.workspaceId, d];
        }),
      );
    const w2Before = (await byId())[W2];

    const board = { ...defaultBoardConfig('0-e1'), colors: { status: { Open: '#00aa00' } } };
    await page.evaluate((b) => window.vermilian.saveBoardConfig(b), board);
    await expect.poll(async () => (await byId())[W1].boards['0-e1']?.colors).toEqual({ status: { Open: '#00aa00' } });
    expect(await page.evaluate(() => window.vermilian.getBoardConfig('0-e1'))).toMatchObject({ colors: { status: { Open: '#00aa00' } } });

    await page.evaluate((w) => window.vermilian.saveDismissal({ workspace: w, issueId: '1-1', dismissedWeekOf: '2026-11-16' }), W1);
    await expect.poll(async () => Object.keys((await byId())[W1].dismissals)).toEqual([dismissalKey(W1, '1-1')]);
    // A dismissal for a workspace that is not active is refused.
    await page.evaluate((w) => window.vermilian.saveDismissal({ workspace: w, issueId: '2-9', dismissedWeekOf: '2026-11-16' }), W2);
    expect((await byId())[W2]).toEqual(w2Before);

    // Configuration changed since activation: the return is refused, nothing moves.
    const markerBefore = await markers(page);
    const r = await api.returnToLegacy(page);
    expect(r).toMatchObject({ ok: false, reason: 'unsafe' });
    expect(await markers(page)).toEqual(markerBefore);
    expect((await api.status(page)).mode).toBe('per-workspace');
  });

  test('return to legacy is allowed when nothing changed; an older client is detected', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), SEED);
    const page = await ready(app);
    expect(await api.activate(page)).toMatchObject({ ok: true });

    // An older Vermilian on another machine rewrites _vermilian-config.
    await page.evaluate((c) => window.vermilian.debugWriteConfigArticle!(c), JSON.stringify({ ...LEGACY, workspaces: [] }));
    expect((await api.status(page)).legacyChangedSinceActivation).toBe(true);
    expect(await api.returnToLegacy(page)).toMatchObject({ ok: false, reason: 'unsafe' });
  });

  test('return to legacy with no change retires the marker and keeps the articles', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), SEED);
    const page = await ready(app);
    expect(await api.activate(page)).toMatchObject({ ok: true });
    const articles = await workspaceArticles(page);

    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await page.getByTestId('storage-return-btn').click();
    await page.getByTestId('storage-confirm-btn').click();
    await expect(page.getByTestId('storage-outcome')).toContainText('Back on the shared configuration');

    expect(await api.status(page)).toMatchObject({ mode: 'legacy', marker: 'retired', guard: { allowed: true } });
    expect(await workspaceArticles(page)).toEqual(articles);
  });
});

/**
 * Applying the Markdown import (VERM-104), in the packaged app, under both
 * storage modes. Applying the spec's section 5 example creates the workspace
 * Ship the offline reader with #1..5 in file order, its section and notes in
 * place and READ-9 unscheduled; no project moves; the current workspace stays
 * active; and a runway-backups copy from just before Apply holds the
 * pre-Apply state — a recognisable row seeded in another workspace, at its
 * original position, and none of the imported rows.
 *
 * The example's link is on the fake YouTrack's own host (http://e2e.local) and
 * the fake's Runway projects are switched on. The native picker is stubbed in
 * the main process. Synthetic keys, names and hosts only.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const RUNWAY_ENV = { VERMILIAN_E2E_YT_RUNWAY_FIXTURES: '1' };
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const EXAMPLE = [
  '## Ship the offline reader',
  '',
  'Readers lose their place on the train. Target: before the spring release.',
  '',
  '- [ ] http://e2e.local/issue/READ-12 - Cache articles locally',
  '- [ ] SYNC-3 - Conflict-free merge library',
  '- [ ] READ-14 - Sync read state between devices',
  '- [ ] SYNC-7 - Background sync worker',
  '- [ ] READ-20 - Offline indicator in the toolbar',
  '',
  '### Later',
  '',
  '- Look at READ-9 again; it was the first attempt and is mostly obsolete.',
  '',
].join('\n');

async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const stub = async () => ({ canceled: false, filePaths: [target] });
    (dialog as unknown as { showOpenDialog: typeof stub }).showOpenDialog = stub;
  }, filePath);
}

function scratchFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verm104-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const backupsDir = (userDataDir: string) => path.join(userDataDir, 'runway-backups');
const backups = (userDataDir: string) => (fs.existsSync(backupsDir(userDataDir)) ? fs.readdirSync(backupsDir(userDataDir)).sort() : []);

/** A recognisable row in the current workspace, before Apply. */
async function seedMarker(page: Page, workspaceId: string) {
  for (const call of [
    () => page.evaluate((w) => window.vermilian.runwayItemsAddNote({ workspaceId: w, text: 'Pre-Apply marker' }), workspaceId),
    () => page.evaluate((w) => window.vermilian.runwayItemsAddIssue({ workspaceId: w, issueId: 'yt:TEST-1' }), workspaceId),
  ]) {
    const r = await call();
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

/** Opens the picker on the example and applies it. */
async function applyExample(app: ElectronApplication, page: Page) {
  await stubOpenDialog(app, scratchFile('offline-reader.md', EXAMPLE));
  await tid(page, 'runway-import-markdown').click();
  const dialog = tid(page, 'runway-markdown-import');
  await expect(dialog.locator('[data-testid="import-row-number"]')).toHaveText(['#1', '#2', '#3', '#4', '#5']);
  await expect(tid(page, 'import-apply')).toBeEnabled();
  await tid(page, 'import-apply').click();
  await expect(dialog).toHaveCount(0);
}

/** The backup written by Apply holds exactly the seeded rows of `workspaceId` and nothing imported. */
function expectPreApplyBackup(file: string, workspaceId: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT workspace_id, item_id, kind, position, text FROM runway_item ORDER BY workspace_id, position').all() as Array<{
      workspace_id: string;
      item_id: string;
      kind: string;
      position: number;
      text: string | null;
    }>;
    expect(rows.map((r) => [r.workspace_id, Number(r.position), r.kind, r.text ?? r.item_id])).toEqual([
      [workspaceId, 1, 'note', 'Pre-Apply marker'],
      [workspaceId, 2, 'issue', 'yt:TEST-1'],
    ]);
  } finally {
    db.close();
  }
}

/** The new workspace's live Runway: the example's order, READ-9 unscheduled. */
async function expectImportedRunway(page: Page, workspaceId: string) {
  const r = await page.evaluate((w) => window.vermilian.runwayItemsList({ workspaceId: w }), workspaceId);
  if (!r.ok) throw new Error(r.error);
  expect(r.items.map((i) => [i.kind, i.runwayNumber, i.kind === 'issue' ? i.itemId : (i.text ?? '').split('\n')[0]])).toEqual([
    ['note', null, 'Readers lose their place on the train. Target: before the spring release.'],
    ['issue', 1, 'yt:READ-12'],
    ['issue', 2, 'yt:SYNC-3'],
    ['issue', 3, 'yt:READ-14'],
    ['issue', 4, 'yt:SYNC-7'],
    ['issue', 5, 'yt:READ-20'],
    ['section', null, 'Later'],
    ['note', null, '- Look at READ-9 again; it was the first attempt and is mostly obsolete.'],
  ]);
  expect(r.items.some((i) => i.itemId === 'yt:READ-9')).toBe(false);
}

test.describe('Runway: applying a Markdown import', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('per-workspace storage: the section 5 example is applied after a backup holding the pre-Apply state; no project moves', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, { ...RUNWAY_ENV, VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    let page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    // Fictional values only.
    const doc = (workspaceId: string, name: string, order: number, projectIds: string[]): WorkspaceDocument => ({
      schema: WORKSPACE_SCHEMA_VERSION,
      workspaceId,
      name,
      order,
      backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
      ai: { credentialRef: 'anthropic-1' },
      folders: [{ id: `folder-${order}`, name: 'Projects', order: 0, parentId: null, projectIds }],
      boards: {},
      dismissals: {},
    });
    for (const d of [doc('ws-e2ea104', 'Workspace A', 0, ['0-e1', '0-e3']), doc('ws-e2eb104', 'Workspace B', 1, ['0-e2'])]) {
      const r = await page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    await page.reload();
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    if ((await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId !== 'ws-e2ea104') {
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Workspace A' }).click();
    }
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId).toBe('ws-e2ea104');
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();

    const articles = async () => {
      const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
      if (!listed.ok) throw new Error(listed.message);
      return listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
    };
    const projectsOf = (docs: WorkspaceDocument[]) => Object.fromEntries(docs.map((d) => [d.workspaceId, d.folders.flatMap((f) => f.projectIds).sort()]));
    const projectsBefore = projectsOf(await articles());
    await seedMarker(page, 'ws-e2ea104');
    const backupsBefore = backups(userDataDir);

    await applyExample(app, page);

    // A backup appeared during Apply, and it holds the pre-Apply state.
    const added = backups(userDataDir).filter((f) => !backupsBefore.includes(f));
    expect(added).toHaveLength(1);
    expectPreApplyBackup(path.join(backupsDir(userDataDir), added[0]), 'ws-e2ea104');

    // The new workspace: the connection and its credential reference copied, no AI credential, no projects.
    const after = await articles();
    const created = after.find((d) => d.name === 'Ship the offline reader');
    expect(created).toBeDefined();
    expect(created?.backend).toEqual({ kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' });
    expect(created?.ai.credentialRef).toBeNull();
    expect(created?.folders.flatMap((f) => f.projectIds)).toEqual([]);
    // Every existing project stays in its original workspace.
    const projectsAfter = projectsOf(after);
    expect({ 'ws-e2ea104': projectsAfter['ws-e2ea104'], 'ws-e2eb104': projectsAfter['ws-e2eb104'] }).toEqual(projectsBefore);

    await expectImportedRunway(page, created?.workspaceId as string);
    // The seeded rows are untouched, and the current workspace stays active.
    const a = await page.evaluate(() => window.vermilian.runwayItemsList({ workspaceId: 'ws-e2ea104' }));
    expect(a.ok && a.items.map((i) => i.text ?? i.itemId)).toEqual(['Pre-Apply marker', 'yt:TEST-1']);
    expect((await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId).toBe('ws-e2ea104');
    await expect(tid(page, 'runway-view')).toBeVisible();
  });

  test('legacy storage: the example is applied as a new workspace on the configured YouTrack; the backup holds the pre-Apply state', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, RUNWAY_ENV);
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const activeId = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;
    await tid(page, 'nav-runway').click();
    await expect(tid(page, 'runway-view')).toBeVisible();
    const configBefore = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    await seedMarker(page, activeId);
    const backupsBefore = backups(userDataDir);

    await applyExample(app, page);

    const added = backups(userDataDir).filter((f) => !backupsBefore.includes(f));
    expect(added).toHaveLength(1);
    expectPreApplyBackup(path.join(backupsDir(userDataDir), added[0]), activeId);

    const configAfter = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const created = configAfter?.workspaces.find((w) => w.name === 'Ship the offline reader');
    expect(created).toBeDefined();
    expect(created?.folders).toEqual([]);
    // Every existing workspace, and its projects, is as it was.
    expect(configAfter?.workspaces.filter((w) => w.id !== created?.id)).toEqual(configBefore?.workspaces);
    await expectImportedRunway(page, created?.id as string);
    expect((await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId).toBe(activeId);
  });

  test('a group mapped to a workspace whose Runway has rows cannot be applied yet, and says why', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), RUNWAY_ENV);
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const activeId = (await page.evaluate(() => window.vermilian.getActiveWorkspace())).workspaceId;
    await tid(page, 'nav-runway').click();
    await seedMarker(page, activeId);
    // Content before any heading maps to the active workspace, whose Runway has rows.
    await stubOpenDialog(app, scratchFile('list.md', '- READ-12 Cache articles locally\n'));
    await tid(page, 'runway-import-markdown').click();
    const group = tid(page, 'runway-markdown-import').locator('[data-testid="import-group"]').first();
    await expect(group.locator('[data-testid="import-group-blocker"][data-reason="runway-not-empty"]')).toBeVisible();
    await expect(tid(page, 'import-apply')).toBeDisabled();
    // Making it a new, named workspace clears the way.
    await group.locator('[data-testid="import-workspace"]').selectOption({ label: 'New workspace' });
    await group.locator('[data-testid="import-rename"]').click();
    await group.locator('[data-testid="import-rename-input"]').fill('Reader backlog');
    await group.locator('[data-testid="import-rename-save"]').click();
    await expect(tid(page, 'import-apply')).toBeEnabled();
    await tid(page, 'import-cancel').click();
  });

  test('while Apply runs the preview is frozen: Skip, Undo and Escape do nothing, and what is written is what stayed on screen', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { ...RUNWAY_ENV, VERMILIAN_E2E_RUNWAY_APPLY_HOLD_MS: '2500' });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await tid(page, 'nav-runway').click();
    await stubOpenDialog(app, scratchFile('two.md', ['## Keep me', '- READ-12 Cache', '', '## Also keep', '- SYNC-3 Merge', ''].join('\n')));
    await tid(page, 'runway-import-markdown').click();
    const dialog = tid(page, 'runway-markdown-import');
    const groups = dialog.locator('[data-testid="import-group"]');
    await expect(dialog.locator('[data-testid="import-row-number"]')).toHaveText(['#1', '#1']);
    // One edit, so Undo would have something to undo.
    await groups.nth(0).locator('[data-testid="import-rename"]').click();
    await groups.nth(0).locator('[data-testid="import-rename-input"]').fill('Keep me (renamed)');
    await groups.nth(0).locator('[data-testid="import-rename-save"]').click();
    await expect(tid(page, 'import-undo')).toBeEnabled();

    await tid(page, 'import-apply').click();
    await expect(tid(page, 'import-apply')).toHaveText('Applying…');
    const skip = groups.nth(1).locator('[data-testid="import-skip"]');
    await expect(skip).toBeDisabled();
    await skip.click({ force: true });
    await expect(tid(page, 'import-undo')).toBeDisabled();
    await expect(tid(page, 'import-cancel')).toBeDisabled();
    await expect(groups.nth(0).locator('[data-testid="import-workspace"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(groups.nth(1)).not.toHaveAttribute('data-skipped', 'true');

    // Released: both groups, as they stayed on screen, are written.
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    const config = await page.evaluate(() => window.vermilian.getWorkspaceConfig());
    const byName = (n: string) => config?.workspaces.find((w) => w.name === n);
    expect(byName('Keep me (renamed)')).toBeDefined();
    expect(byName('Also keep')).toBeDefined();
    for (const [name, issue] of [['Keep me (renamed)', 'yt:READ-12'], ['Also keep', 'yt:SYNC-3']] as const) {
      const r = await page.evaluate((w) => window.vermilian.runwayItemsList({ workspaceId: w }), byName(name)?.id as string);
      expect(r.ok && r.items.map((i) => i.itemId)).toEqual([issue]);
    }
  });
});

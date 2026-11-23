/**
 * Each workspace chooses its prerequisite link types (VERM-96) from its own
 * tracker's link types, in Manage workspaces → Prerequisites…, and the choice
 * persists in the workspace's own article. Against the fake YouTrack and
 * Jira, under the per-workspace storage e2e gate. Every value is fictional.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const YT: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2epq1',
  name: 'YouTrack PQ',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-pq' },
  ai: { credentialRef: 'anthropic-e2e' },
  masterPlan: { articleId: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
};
const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-e2epq2',
  name: 'Jira PQ',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

let app: ElectronApplication;
let page: Page;

async function launch(seeds: WorkspaceDocument[], env: Record<string, string> = {}) {
  app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace', ...env });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  for (const d of seeds) {
    const r = await page.evaluate((doc) => window.vermilian.createWorkspaceArticle(doc), d);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
}

async function readDoc(workspaceId: string): Promise<WorkspaceDocument> {
  const r = await page.evaluate((id) => window.vermilian.readWorkspaceArticle(id), workspaceId);
  if (!r.ok || r.entry.status !== 'ok') throw new Error('workspace article not readable');
  return r.entry.document;
}

async function openPrerequisites(name: string) {
  await tid(page, 'workspace-switcher').click();
  await tid(page, 'manage-workspaces-btn').click();
  await page.locator(`[data-testid="workspace-row"][data-ws-name="${name}"] [data-testid="workspace-prerequisites-btn"]`).click();
  await expect(tid(page, 'workspace-prerequisites-current')).toBeVisible();
}

const row = (type: string) => page.locator(`[data-testid="workspace-prerequisites-row"][data-link-type="${type}"]`);
const option = (type: string, side: 'none' | 'inward' | 'outward') =>
  row(type).locator(`[data-testid="workspace-prerequisites-option"][data-side="${side}"]`);

test.afterEach(async () => { await app.close(); });

test("a YouTrack workspace's choice of link type and side persists, and Reset returns it to the default", async () => {
  await launch([YT, JIRA]);
  await openPrerequisites('YouTrack PQ');
  await expect(tid(page, 'workspace-prerequisites-current')).toHaveText('Current: Default: Depend (“depends on”)');
  // The tracker's own types and wordings; Subtask and Relates can't be chosen.
  await expect(option('Depend', 'inward')).toBeChecked();
  await expect(row('Depend')).toContainText('This ticket depends on it');
  await expect(row('Subtask').locator('[data-testid="workspace-prerequisites-disabled"]')).toBeVisible();
  await expect(row('Relates').locator('[data-testid="workspace-prerequisites-disabled"]')).toBeVisible();
  await expect(row('Subtask').locator('[data-testid="workspace-prerequisites-option"]')).toHaveCount(0);

  // A custom type worded the other way: "needs" is its outward side.
  await option('Required by', 'outward').check();
  await option('Depend', 'none').check();
  await tid(page, 'workspace-prerequisites-save').click();
  await expect(page.locator('#workspace-prerequisites-modal')).toHaveCount(0);
  await expect.poll(async () => (await readDoc(YT.workspaceId)).prerequisiteLinkTypes).toEqual([{ type: 'Required by', side: 'outward' }]);
  const saved = await readDoc(YT.workspaceId);
  expect({ ...saved, prerequisiteLinkTypes: undefined }).toEqual({ ...YT, prerequisiteLinkTypes: undefined });

  // Survives a reload, and shows as chosen.
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  await openPrerequisites('YouTrack PQ');
  await expect(tid(page, 'workspace-prerequisites-current')).toHaveText('Current: Required by (“needs”)');
  await expect(option('Required by', 'outward')).toBeChecked();
  await expect(option('Depend', 'none')).toBeChecked();

  await tid(page, 'workspace-prerequisites-reset').click();
  await expect(page.locator('#workspace-prerequisites-modal')).toHaveCount(0);
  await expect.poll(async () => 'prerequisiteLinkTypes' in (await readDoc(YT.workspaceId))).toBe(false);
  // The other workspace was never touched.
  expect((await readDoc(JIRA.workspaceId)).prerequisiteLinkTypes).toBeUndefined();
});

test('a Jira workspace defaults to "is blocked by" and can save no prerequisite types at all', async () => {
  await launch([YT, JIRA]);
  await openPrerequisites('Jira PQ');
  await expect(tid(page, 'workspace-prerequisites-current')).toHaveText('Current: Default: Blocks (“is blocked by”)');
  await expect(option('Blocks', 'inward')).toBeChecked();
  await expect(row('Blocks')).toContainText('This ticket is blocked by it');
  await expect(row('Relates').locator('[data-testid="workspace-prerequisites-disabled"]')).toBeVisible();

  await option('Blocks', 'none').check();
  await tid(page, 'workspace-prerequisites-save').click();
  await expect.poll(async () => (await readDoc(JIRA.workspaceId)).prerequisiteLinkTypes).toEqual([]);
  await openPrerequisites('Jira PQ');
  await expect(tid(page, 'workspace-prerequisites-current')).toHaveText('Current: None: no link makes a ticket a prerequisite');
});

// ─── Concurrent saves keep the Master plan (VERM-96 review) ─────────────────

test('two sessions saving from the same document keep both the prerequisite choice and the Master plan', async () => {
  const seeded = { ...YT, masterPlan: { articleId: 'VERM-A-5' } };
  await launch([seeded]);
  const base = await readDoc(YT.workspaceId);
  const prereqs = { ...base, prerequisiteLinkTypes: [{ type: 'Required by', side: 'outward' as const }] };
  const plan = { ...base, masterPlan: { articleId: 'VERM-A-9' } };
  for (const edited of [prereqs, plan]) {
    const r = await page.evaluate(([b, e]) => window.vermilian.updateWorkspaceArticle(b, e), [base, edited] as const);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  const after = await readDoc(YT.workspaceId);
  expect(after.prerequisiteLinkTypes).toEqual([{ type: 'Required by', side: 'outward' }]);
  expect(after.masterPlan).toEqual({ articleId: 'VERM-A-9' });
});

test('a rename and a Master plan change saved from the same document both survive', async () => {
  await launch([{ ...YT, masterPlan: { articleId: 'VERM-A-5' } }]);
  const base = await readDoc(YT.workspaceId);
  for (const edited of [{ ...base, name: 'Renamed PQ' }, { ...base, masterPlan: { articleId: 'VERM-A-9' } }]) {
    const r = await page.evaluate(([b, e]) => window.vermilian.updateWorkspaceArticle(b, e), [base, edited] as const);
    expect(r.ok).toBe(true);
  }
  await page.reload();
  await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  const after = await readDoc(YT.workspaceId);
  expect(after.name).toBe('Renamed PQ');
  expect(after.masterPlan).toEqual({ articleId: 'VERM-A-9' });
});

// ─── The tracker can't be reached (VERM-96 review) ──────────────────────────

// Holds nothing for its backend but the prerequisite choice, so once that is
// reset it may switch tracker.
const SWITCHABLE: WorkspaceDocument = { ...YT, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: [] }] };
const TO_JIRA = { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' } as const;

async function switchToJira() {
  const base = await readDoc(YT.workspaceId);
  return page.evaluate(([b, backend]) => window.vermilian.updateWorkspaceArticle(b, { ...b, backend }), [base, TO_JIRA] as const);
}

for (const [label, chosen] of [
  ['a custom selection', [{ type: 'Required by', side: 'outward' as const }]],
  ['an explicitly empty list', []],
] as const) {
  test(`with the tracker unreachable, ${label} is kept on close and removed by an explicit reset`, async () => {
    await launch([{ ...SWITCHABLE, prerequisiteLinkTypes: [...chosen] }], { VERMILIAN_E2E_LINK_TYPES_FAIL: '1' });
    // The saved choice holds the tracker switch.
    const held = await switchToJira();
    expect(held.ok).toBe(false);
    expect(!held.ok && held.message).toContain('prerequisite link types');

    // Shown, not editable; closing keeps it.
    await openPrerequisites('YouTrack PQ');
    await expect(tid(page, 'workspace-prerequisites-types-error')).toContainText('could not be read');
    await expect(tid(page, 'workspace-prerequisites-current')).toHaveText(
      chosen.length ? 'Current: Required by (outward side)' : 'Current: None: no link makes a ticket a prerequisite',
    );
    await expect(tid(page, 'workspace-prerequisites-save')).toHaveCount(0);
    await expect(tid(page, 'workspace-prerequisites-option')).toHaveCount(0);
    await expect(tid(page, 'workspace-prerequisites-reset')).toBeEnabled();
    await tid(page, 'workspace-prerequisites-close').click();
    await expect(page.locator('#workspace-prerequisites-modal')).toHaveCount(0);
    expect((await readDoc(YT.workspaceId)).prerequisiteLinkTypes).toEqual(chosen);

    // A failed reset shows the error and keeps the saved choice in view.
    await openPrerequisites('YouTrack PQ');
    await page.evaluate(() => window.vermilian.debugFailWorkspaceWrites!(1));
    await tid(page, 'workspace-prerequisites-reset').click();
    await expect(tid(page, 'workspace-prerequisites-save-error')).toBeVisible();
    await expect(tid(page, 'workspace-prerequisites-current')).toBeVisible();
    expect((await readDoc(YT.workspaceId)).prerequisiteLinkTypes).toEqual(chosen);

    // An explicit reset goes through the normal save and survives a reload.
    await tid(page, 'workspace-prerequisites-reset').click();
    await expect(page.locator('#workspace-prerequisites-modal')).toHaveCount(0);
    await page.reload();
    await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
    expect('prerequisiteLinkTypes' in (await readDoc(YT.workspaceId))).toBe(false);

    // Nothing else holds the workspace to YouTrack now.
    const switched = await switchToJira();
    expect(switched.ok).toBe(true);
    expect((await readDoc(YT.workspaceId)).backend.kind).toBe('jira');
  });
}

test('with the tracker unreachable and nothing saved, there is nothing to reset', async () => {
  await launch([SWITCHABLE], { VERMILIAN_E2E_LINK_TYPES_FAIL: '1' });
  await openPrerequisites('YouTrack PQ');
  await expect(tid(page, 'workspace-prerequisites-types-error')).toBeVisible();
  await expect(tid(page, 'workspace-prerequisites-current')).toHaveText('Current: Default: Depend (inward side)');
  await expect(tid(page, 'workspace-prerequisites-reset')).toHaveCount(0);
  await expect(tid(page, 'workspace-prerequisites-save')).toHaveCount(0);
});

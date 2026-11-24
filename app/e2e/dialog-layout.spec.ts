/**
 * Dialog heading layout across every Vermilian dialog (VERM-118), with the
 * VERM-116 check (helpers/dialogLayout.ts): the heading inset at least 16px
 * from the dialog's top and left edges, clear of the close button, and the
 * dialog's action buttons wholly inside it. Stand-Up has its own spec
 * (standup-dialog-layout.spec.ts).
 *
 * Each dialog is opened the way its own feature spec opens it, against the
 * fake backends. Run with DIALOG_LAYOUT_RECORD=<file> to record every
 * dialog's measurement as a JSON line.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchApp, launchAppWithEnv, launchAppWithUserDataDir } from './helpers/launch';
import { expectDialogLayout } from './helpers/dialogLayout';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
/** A dialog's own button by its text — never Vibe's close (X) button. */
const textButton = (dialog: Locator, text: string) =>
  dialog.locator('button:not([data-testid^="modal-close-button"])').filter({ hasText: new RegExp(`^${text}$`) }).first();

let app: ElectronApplication | undefined;
test.afterEach(async () => { await app?.close(); app = undefined; });

async function ready(a: ElectronApplication, selector = '[data-testid="nav-project"]'): Promise<Page> {
  const page = await a.firstWindow();
  await page.waitForSelector(selector, { timeout: 15_000 });
  return page;
}

async function openFirstProject(page: Page) {
  await tid(page, 'nav-project').first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Dialogs opened from the board', () => {
  test('Create task', async () => {
    app = await launchApp();
    const page = await ready(app);
    await openFirstProject(page);
    await tid(page, 'new-task-btn').click();
    const dialog = page.locator('#create-task-modal');
    await expectDialogLayout('create-task', dialog, dialog.getByRole('heading', { name: 'Create task', exact: true }), {
      Create: tid(page, 'task-create-btn'),
    });
  });

  test('AI create, and its review step', async () => {
    app = await launchApp();
    const page = await ready(app);
    await openFirstProject(page);
    await tid(page, 'ai-create-btn').click();
    const dialog = page.locator('#ai-create-modal');
    await expectDialogLayout('ai-create', dialog, dialog.getByRole('heading', { name: 'AI create task', exact: true }), {
      Generate: tid(page, 'ai-generate-btn'),
    });

    await page.locator('#ai-description').fill('Fix the login crash on Safari — critical, JIRA-456');
    await tid(page, 'ai-generate-btn').click();
    await expectDialogLayout('ai-create-review', dialog, dialog.getByRole('heading', { name: 'Review AI-generated task', exact: true }), {
      Create: tid(page, 'ai-create-submit'),
    });
  });

  test('Daily Review', async () => {
    app = await launchApp();
    const page = await ready(app);
    await tid(page, 'daily-review-btn').click();
    await page.waitForSelector('[data-testid="daily-review-body"]', { timeout: 15_000 });
    const dialog = page.locator('#daily-review-modal');
    await expectDialogLayout('daily-review', dialog, dialog.getByRole('heading', { name: /^Daily Review — / }), {
      Close: textButton(dialog, 'Close'),
    });
  });

  test('Jira list', async () => {
    app = await launchAppWithEnv({
      VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: JSON.stringify({ version: 1, profile: { siteUrl: 'https://example.atlassian.net', email: 'me@example.com', cloudId: '' } }),
    });
    const page = await ready(app);
    await tid(page, 'jira-list-btn').click();
    const dialog = page.locator('#jira-list-modal');
    await expectDialogLayout('jira-list', dialog, dialog.getByRole('heading', { name: 'Jira — open issues assigned to me' }), {
      Close: textButton(dialog, 'Close'),
    });
  });
});

test.describe('Jira list without a Jira profile', () => {
  test('Jira list, "not set up" notice', async () => {
    app = await launchApp();
    const page = await ready(app);
    await tid(page, 'jira-list-btn').click();
    const dialog = page.locator('#jira-list-modal');
    await expect(tid(page, 'jira-list-not-configured')).toBeVisible({ timeout: 15_000 });
    await expectDialogLayout('jira-list-not-configured', dialog, dialog.getByRole('heading', { name: 'Jira — open issues assigned to me' }), {
      Close: textButton(dialog, 'Close'),
    });
  });
});

test.describe('Settings confirmations', () => {
  test('Discard unsaved changes', async () => {
    app = await launchApp();
    const page = await ready(app);
    await tid(page, 'rail-settings-btn').click();
    await page.getByPlaceholder(/^Token saved|Paste your YouTrack permanent token/).fill('new-secret-token');
    await page.getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.locator('#discard-credentials-modal');
    await expectDialogLayout('discard-credentials', dialog, dialog.getByRole('heading', { name: 'Discard unsaved changes?' }), {
      'Keep editing': textButton(dialog, 'Keep editing'),
    });
  });

  test('OpenBao confirmation', async () => {
    app = await launchApp();
    const page = await ready(app);
    await tid(page, 'topbar-settings-btn').click();
    await expect(tid(page, 'openbao-section')).toBeVisible();
    await tid(page, 'openbao-url').fill('http://127.0.0.1:9');
    await tid(page, 'openbao-role-id').fill('fake-role-id');
    await tid(page, 'openbao-secret-command').fill('echo fake-secret-id');
    await tid(page, 'openbao-save').click();
    await expect(tid(page, 'openbao-outcome')).toContainText('Connection saved');
    await tid(page, 'openbao-ref-youtrack-1').getByRole('button', { name: 'Delete from OpenBao' }).click();
    const dialog = page.locator('#openbao-confirm');
    await expectDialogLayout('openbao-confirm', dialog, dialog.getByRole('heading').first(), {
      Confirm: tid(page, 'openbao-confirm-btn'),
      Cancel: textButton(dialog, 'Cancel'),
    });
  });

  test('Replace Runway metadata', async () => {
    const userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir);
    const page = await ready(app);
    const r = await page.evaluate(() => window.vermilian.runwayUpdate({ workspaceId: 'workspace-default', issueId: 'jira:DEMO-101', patch: { focusRank: 1, whyNow: 'Layout check' } }));
    expect(r.ok).toBe(true);
    const snapshot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verm118-')), 'runway.sqlite');
    await app.evaluate(({ dialog }, target) => {
      (dialog as unknown as { showSaveDialog: () => Promise<unknown> }).showSaveDialog = async () => ({ canceled: false, filePath: target });
      (dialog as unknown as { showOpenDialog: () => Promise<unknown> }).showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, snapshot);
    const exported = await page.evaluate(() => window.vermilian.runwayExportSnapshot());
    expect(exported.ok && !exported.canceled).toBe(true);

    await tid(page, 'topbar-settings-btn').click();
    await tid(page, 'runway-import-btn').click();
    const dialog = page.locator('#runway-import-modal');
    await expectDialogLayout('runway-import', dialog, dialog.getByRole('heading', { name: 'Replace all Runway metadata?' }), {
      Replace: tid(page, 'runway-import-confirm'),
      Cancel: tid(page, 'runway-import-cancel'),
    });
  });

  test('Activate per-workspace storage', async () => {
    const W1 = 'workspace-1700000000001';
    const legacy = {
      version: 1,
      activeWorkspaceId: W1,
      workspaces: [{ id: W1, name: 'Workspace A', order: 0, folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }] }],
    };
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_ARTICLE_CONTENT: JSON.stringify(legacy),
      VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: JSON.stringify({ version: 1, profile: { siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '' } }),
    });
    const page = await ready(app, '[data-testid="topbar-settings-btn"]');
    await tid(page, 'topbar-settings-btn').click();
    const section = tid(page, 'storage-section');
    await section.locator('input[data-testid="storage-jira-name"], [data-testid="storage-jira-name"] input').first().fill('Workspace J');
    await section.getByTestId('storage-preview-btn').click();
    await expect(section.getByTestId('storage-preview')).toBeVisible();
    await section.getByTestId('storage-activate-btn').click();
    const dialog = page.locator('#storage-confirm-modal');
    await expectDialogLayout('storage-confirm', dialog, dialog.getByRole('heading', { name: 'Activate per-workspace storage?' }), {
      Activate: tid(page, 'storage-confirm-btn'),
      Cancel: tid(page, 'storage-cancel-btn'),
    });
  });
});

test.describe('Workspace dialogs (per-workspace storage)', () => {
  const YT: WorkspaceDocument = {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: 'ws-e2edl1',
    name: 'YouTrack DL',
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-dl' },
    ai: { credentialRef: 'anthropic-e2e' },
    masterPlan: { articleId: null },
    folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
    boards: {},
    dismissals: {},
  };
  const JIRA: WorkspaceDocument = {
    ...YT,
    workspaceId: 'ws-e2edl2',
    name: 'Jira DL',
    order: 1,
    backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
    folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: [] }],
  };
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await ready(app, '[data-testid="topbar-settings-btn"]');
    for (const d of [YT, JIRA]) {
      const r = await page.evaluate((doc) => window.vermilian.createWorkspaceArticle(doc), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  });

  async function switchTo(name: string) {
    await tid(page, 'workspace-switcher').click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    await expect(tid(page, 'workspace-switcher')).toContainText(name);
  }

  async function openManage() {
    await tid(page, 'workspace-switcher').click();
    await tid(page, 'manage-workspaces-btn').click();
    return page.locator('#manage-workspaces-modal');
  }

  test('Manage workspaces', async () => {
    const dialog = await openManage();
    await expectDialogLayout('manage-workspaces', dialog, dialog.getByRole('heading', { name: 'Manage workspaces' }), {
      Done: textButton(dialog, 'Done'),
    });
  });

  test('AI credential', async () => {
    await openManage();
    await page.locator('[data-testid="workspace-row"][data-ws-name="YouTrack DL"] [data-testid="workspace-ai-btn"]').click();
    const dialog = page.locator('#workspace-ai-credential-modal');
    await expectDialogLayout('workspace-ai-credential', dialog, dialog.getByRole('heading', { name: /^AI credential/ }), {
      Save: tid(page, 'workspace-ai-save'),
      None: tid(page, 'workspace-ai-none'),
    });
  });

  test('Master plan', async () => {
    await openManage();
    await page.locator('[data-testid="workspace-row"][data-ws-name="YouTrack DL"] [data-testid="workspace-master-plan-btn"]').click();
    const dialog = page.locator('#workspace-master-plan-modal');
    await expectDialogLayout('workspace-master-plan', dialog, dialog.getByRole('heading', { name: /^Master plan/ }), {
      Save: tid(page, 'workspace-master-plan-save'),
      None: tid(page, 'workspace-master-plan-none'),
    });
  });

  test('Prerequisites', async () => {
    await openManage();
    await page.locator('[data-testid="workspace-row"][data-ws-name="YouTrack DL"] [data-testid="workspace-prerequisites-btn"]').click();
    const dialog = page.locator('#workspace-prerequisites-modal');
    await expectDialogLayout('workspace-prerequisites', dialog, dialog.getByRole('heading', { name: /^Prerequisites/ }), {
      Save: tid(page, 'workspace-prerequisites-save'),
      Close: tid(page, 'workspace-prerequisites-close'),
    });
  });

  test('Add projects', async () => {
    await switchTo('YouTrack DL');
    await tid(page, 'add-projects-btn').click();
    const dialog = page.locator('#add-projects-modal');
    await expectDialogLayout('add-projects', dialog, dialog.getByRole('heading', { name: /^Add projects to/ }), {
      Save: tid(page, 'add-projects-save'),
      Cancel: textButton(dialog, 'Cancel'),
    });
  });

  test('Jira projects and boards', async () => {
    await switchTo('Jira DL');
    await page.locator('[data-testid="choose-jira-projects-btn"], [data-testid="rail-choose-jira-projects-btn"]').first().click();
    const dialog = page.locator('#jira-projects-modal');
    await expect(tid(page, 'jira-projects-row').first()).toBeVisible({ timeout: 15_000 });
    await expectDialogLayout('jira-projects', dialog, dialog.getByRole('heading', { name: /^Jira projects and boards/ }), {
      Save: tid(page, 'jira-projects-save'),
      Cancel: textButton(dialog, 'Cancel'),
    });
  });
});

/**
 * Creating a workspace with an explicit backend, and choosing a Jira
 * workspace's projects (VERM-33), against the fake YouTrack and fake Jira.
 *
 * Per-workspace storage is the e2e stand-in for the activation gate VERM-53
 * owns (VERMILIAN_E2E_WORKSPACE_STORAGE=per-workspace); only it can hold a
 * Jira workspace. Legacy storage offers YouTrack alone. Neither has a default
 * backend: Create stays disabled until one is chosen.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const switcher = (page: Page) => page.locator('[data-testid="workspace-switcher"]');
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function openNewWorkspaceForm(page: Page, name: string) {
  await switcher(page).click();
  await tid(page, 'new-workspace-btn').click();
  await tid(page, 'new-workspace-input').fill(name);
}

test.describe('New workspace — legacy storage', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('Create waits for an explicit backend; Jira is not offered without per-workspace storage', async () => {
    await openNewWorkspaceForm(page, 'Choose first');
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await expect(tid(page, 'new-workspace-backend-jira')).toBeDisabled();
    await expect(tid(page, 'new-workspace-backend-youtrack')).toHaveAttribute('aria-checked', 'false');

    await tid(page, 'new-workspace-backend-youtrack').click();
    await expect(tid(page, 'new-workspace-backend-youtrack')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'new-workspace-submit')).toBeEnabled();
    await tid(page, 'new-workspace-submit').click();
    await expect(switcher(page)).toContainText('Choose first');
  });
});

// Fictional values only (ADR-0011 §10).
const SEED: WorkspaceDocument = {
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId: 'ws-e2eyt1',
  name: 'Workspace A',
  order: 0,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: null },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
};

async function readAllWorkspaces(page: Page): Promise<WorkspaceDocument[]> {
  const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
  if (!listed.ok) throw new Error(listed.message);
  return listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
}

test.describe('New workspace and Jira projects — per-workspace storage (e2e gate)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), SEED);
    expect(r.ok).toBe(true);
    await page.reload();
    await expect(switcher(page)).toContainText('Workspace A', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('creates a Jira workspace and picks a Jira project', async () => {
    await openNewWorkspaceForm(page, 'Work');
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await tid(page, 'new-workspace-backend-jira').click();
    // Jira needs its site and account before Create is enabled.
    await expect(tid(page, 'new-workspace-submit')).toBeDisabled();
    await tid(page, 'new-workspace-site-url').fill('https://example.atlassian.net');
    await tid(page, 'new-workspace-email').fill('user@example.com');
    await expect(tid(page, 'new-workspace-credential-ref')).toHaveValue('jira-1');
    await tid(page, 'new-workspace-submit').click();

    await expect(switcher(page)).toContainText('Work');
    await expect(tid(page, 'workspace-backend')).toHaveText('Jira · example.atlassian.net');
    await expect(tid(page, 'jira-workspace-projects')).toHaveText('No Jira projects chosen yet.');

    const created = (await readAllWorkspaces(page)).find((d) => d.name === 'Work')!;
    expect(created.backend).toEqual({ kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' });
    expect(created.order).toBe(1);

    // The picker lists the fake Jira's projects through the workspace's own connection.
    await tid(page, 'choose-jira-projects-btn').click();
    const rows = tid(page, 'jira-projects-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-project-key', 'DEMO');
    await rows.filter({ has: page.locator('input') }).nth(0).locator('input').check();
    await tid(page, 'jira-projects-save').click();
    await expect(page.locator('#jira-projects-modal')).toHaveCount(0);

    await expect(tid(page, 'jira-workspace-projects')).toHaveText('Jira projects: DEMO');
    const saved = (await readAllWorkspaces(page)).find((d) => d.workspaceId === created.workspaceId)!;
    expect(saved.folders.flatMap((f) => f.projectIds)).toEqual(['DEMO']);
    expect(saved.backend.kind).toBe('jira');

    // Reopening shows the saved selection.
    await tid(page, 'choose-jira-projects-btn').click();
    await expect(page.locator('[data-project-key="DEMO"] input')).toBeChecked();
    await expect(page.locator('[data-project-key="OPS"] input')).not.toBeChecked();
  });

  test('a new YouTrack workspace takes the configured server, and its backend stays YouTrack', async () => {
    await openNewWorkspaceForm(page, 'Home 2');
    await tid(page, 'new-workspace-backend-youtrack').click();
    await expect(tid(page, 'new-workspace-server-url')).toHaveValue('http://e2e.local');
    await expect(tid(page, 'new-workspace-credential-ref')).toHaveValue('youtrack-1');
    await tid(page, 'new-workspace-submit').click();
    await expect(switcher(page)).toContainText('Home 2');
    await expect(tid(page, 'workspace-backend')).toHaveText('YouTrack · e2e.local');
    // No Jira picker on a YouTrack workspace.
    await expect(tid(page, 'choose-jira-projects-btn')).toHaveCount(0);
  });

  test('changing the backend of a workspace that has projects is refused, and nothing is lost', async () => {
    const jiraWs = (await page.evaluate(
      (d) => window.vermilian.createWorkspaceArticle(d),
      {
        ...SEED,
        workspaceId: 'ws-e2ejr9',
        name: 'Jira one',
        order: 1,
        backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
        folders: [{ id: 'folder-b', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
      },
    ));
    expect(jiraWs.ok).toBe(true);
    const base = (await readAllWorkspaces(page)).find((d) => d.workspaceId === 'ws-e2ejr9')!;
    const r = await page.evaluate(
      ([b, e]) => window.vermilian.updateWorkspaceArticle(b, e),
      [base, { ...base, backend: SEED.backend }] as const,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/would discard them/);
    const after = (await readAllWorkspaces(page)).find((d) => d.workspaceId === 'ws-e2ejr9')!;
    expect(after.backend.kind).toBe('jira');
    expect(after.folders.flatMap((f) => f.projectIds)).toEqual(['DEMO']);
  });

  test('a Jira workspace renders its issues read-only; cards cannot be dragged', async () => {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), {
      ...SEED,
      workspaceId: 'ws-e2ejr2',
      name: 'Jira board',
      order: 1,
      backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
    });
    expect(r.ok).toBe(true);
    await page.reload();
    await switcher(page).click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira board' }).click();

    const board = tid(page, 'jira-workspace-board');
    await expect(board).toBeVisible();
    await expect(tid(page, 'jira-board-read-only')).toHaveText('Jira · read-only');
    await expect(tid(page, 'jira-card')).toHaveCount(3);
    await expect(tid(page, 'jira-issue-count')).toHaveText('3 issues');

    // Columns follow what each status means: To Do, then the in-progress ones.
    const columns = tid(page, 'jira-column');
    await expect(columns).toHaveCount(3);
    await expect(columns.nth(0)).toHaveAttribute('data-status', 'To Do');
    await expect(columns.nth(0)).toHaveAttribute('data-role', 'todo');
    await expect(columns.nth(0).locator('[data-testid="jira-card"]')).toHaveAttribute('data-issue-key', 'DEMO-102');
    const inProgress = page.locator('[data-testid="jira-column"][data-status="In Progress"]');
    await expect(inProgress.locator('[data-testid="jira-card"]')).toContainText('Rotate the staging database credentials');
    await expect(inProgress.locator('[data-testid="jira-card-priority"]')).toHaveText('High');
    await expect(page.locator('[data-testid="jira-column"][data-status="Waiting"] [data-testid="jira-card"]')).toHaveAttribute('data-issue-key', 'OPS-7');

    // Drag is disabled: every card is non-draggable, and a drag attempt moves nothing.
    const cards = tid(page, 'jira-card');
    for (let i = 0; i < 3; i++) await expect(cards.nth(i)).toHaveAttribute('draggable', 'false');
    const todoCard = page.locator('[data-issue-key="DEMO-102"]');
    await todoCard.dragTo(inProgress);
    await expect(columns.nth(0).locator('[data-issue-key="DEMO-102"]')).toHaveCount(1);
    await expect(inProgress.locator('[data-issue-key="DEMO-102"]')).toHaveCount(0);

    // The YouTrack board, its timer and its editing controls are not shown.
    await expect(page.locator('[data-testid="workspace-board"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="row-start-timer"]')).toHaveCount(0);
  });

  test("the board reads only the workspace's own Jira projects", async () => {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), {
      ...SEED,
      workspaceId: 'ws-e2ejr3',
      name: 'Demo only',
      order: 1,
      backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
    });
    expect(r.ok).toBe(true);
    const own = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejr3', projectKey: 'DEMO' }));
    expect(own.ok && own.issues.map((i) => i.idReadable).sort()).toEqual(['DEMO-101', 'DEMO-102']);
    expect(own.ok && own.priorities).toEqual(['Highest', 'High', 'Medium', 'Low', 'Lowest', 'None']);
    const other = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejr3', projectKey: 'OPS' }));
    expect(other.ok).toBe(false);
    const yt = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2eyt1', projectKey: 'DEMO' }));
    expect(yt.ok).toBe(false);
  });
  async function openJiraBoard(workspaceId: string, name: string, projectIds: string[]) {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), {
      ...SEED,
      workspaceId,
      name,
      order: 1,
      backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds }],
    });
    expect(r.ok).toBe(true);
    await page.reload();
    await switcher(page).click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    await expect(tid(page, 'jira-workspace-board')).toBeVisible();
  }

  test('a Jira card opens a read-only detail panel with description and comments (VERM-35)', async () => {
    await openJiraBoard('ws-e2ejr4', 'Jira detail', ['DEMO', 'OPS']);
    await page.locator('[data-testid="jira-card"][data-issue-key="DEMO-101"]').click();

    const panel = tid(page, 'jira-issue-detail-panel');
    await expect(panel).toBeVisible();
    await expect(tid(page, 'jira-detail-issue-key')).toHaveText('DEMO-101');
    await expect(tid(page, 'jira-detail-project')).toHaveText('Demo');
    await expect(tid(page, 'jira-detail-summary')).toHaveText('Rotate the staging database credentials');
    await expect(page.locator('[data-testid="jira-card"][data-issue-key="DEMO-101"]')).toHaveAttribute('aria-current', 'true');

    // Only the fields Jira has; YouTrack-only fields are not shown.
    const fields = tid(page, 'jira-detail-field');
    await expect(fields).toHaveCount(3);
    expect(await fields.evaluateAll((els) => els.map((e) => e.getAttribute('data-field')))).toEqual(['status', 'priority', 'dueDate']);
    await expect(panel.locator('[data-field="status"] dd')).toHaveText('In Progress');
    await expect(panel.locator('[data-field="priority"] dd')).toHaveText('High');
    await expect(panel.locator('[data-field="dueDate"] dd')).toHaveText('Dec 1, 2026');
    for (const label of ['Category', 'Ticket #', 'Notes', 'Ghostty tab name', 'Repo URL', 'Working branch', 'Project health']) {
      await expect(panel.locator('dt', { hasText: label })).toHaveCount(0);
    }
    await expect(panel.locator('[aria-label="Focus"], [data-testid^="focus-"]')).toHaveCount(0);

    // Description: rendered Markdown, the safe link only, raw HTML as text.
    const description = tid(page, 'jira-detail-description');
    await expect(description.locator('h2')).toHaveText('Steps');
    await expect(description.locator('ol > li')).toHaveCount(2);
    await expect(description.locator('strong')).toHaveText('staging');
    await expect(description.locator('a')).toHaveCount(1);
    await expect(description.locator('a')).toHaveAttribute('href', 'https://example.com/runbook');
    await expect(description).toContainText('not a link');
    await expect(description).toContainText('<b>raw html</b>');
    await expect(description.locator('b')).toHaveCount(0);

    // Comments, oldest first, the edited one marked.
    await expect(tid(page, 'jira-detail-comment-count')).toHaveText('2');
    const comments = tid(page, 'jira-detail-comment');
    await expect(comments).toHaveCount(2);
    await expect(comments.nth(0)).toContainText('E2E Jira User');
    await expect(comments.nth(0).locator('code')).toHaveText('staging');
    await expect(comments.nth(1)).toContainText('Fictional Reviewer');
    await expect(comments.nth(1)).toContainText('(edited');

    // No edits of any kind: no inputs, no timer, no delete.
    await expect(panel.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
    await expect(panel.locator('[data-testid="detail-start-timer"], [aria-label="Delete task"]')).toHaveCount(0);
    await expect(tid(page, 'task-detail-panel')).toHaveCount(0);

    // Another card swaps the panel; an issue with no description says so.
    await page.locator('[data-testid="jira-card"][data-issue-key="DEMO-102"]').click();
    await expect(tid(page, 'jira-detail-issue-key')).toHaveText('DEMO-102');
    await expect(tid(page, 'jira-detail-description-empty')).toHaveText('No description.');
    await expect(tid(page, 'jira-detail-comment-count')).toHaveText('0');

    // Escape closes it; the keyboard opens it again.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.locator('[data-testid="jira-card"][data-issue-key="OPS-7"]').focus();
    await page.keyboard.press('Enter');
    await expect(tid(page, 'jira-detail-issue-key')).toHaveText('OPS-7');
    await expect(panel.locator('[data-field="priority"] dd')).toHaveText('—');
    await tid(page, 'jira-detail-close').click();
    await expect(panel).toHaveCount(0);
  });

  test("the detail IPC serves only the workspace's own projects and real issue keys", async () => {
    const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), {
      ...SEED,
      workspaceId: 'ws-e2ejr5',
      name: 'Demo detail',
      order: 1,
      backend: { kind: 'jira' as const, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
      folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
    });
    expect(r.ok).toBe(true);
    const get = (workspaceId: string, issueKey: string) =>
      page.evaluate((a) => window.vermilian.getWorkspaceJiraIssueDetail(a), { workspaceId, issueKey });

    const own = await get('ws-e2ejr5', 'DEMO-101');
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.issue.project.shortName).toBe('DEMO');
      expect(own.content.comments.map((c) => c.id)).toEqual(['30001', '30002']);
      expect(own.content.description).toContain('## Steps');
    }
    expect((await get('ws-e2ejr5', 'OPS-7')).ok).toBe(false);
    for (const bad of ['', 'DEMO', 'demo-101', 'DEMO-0', 'DEMO-1 OR 1=1', '../DEMO-1']) {
      const res = await get('ws-e2ejr5', bad);
      expect(res.ok).toBe(false);
    }
    expect((await get('ws-e2eyt1', 'DEMO-101')).ok).toBe(false);
    const missing = await get('ws-e2ejr5', 'DEMO-999');
    expect(missing.ok).toBe(false);
  });
});

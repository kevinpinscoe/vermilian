/**
 * Task creation from each project's own field configuration (VERM-115).
 *
 * The fake YouTrack gives three projects different workflows
 * (VERMILIAN_E2E_YT_CREATE_FIELDS):
 *   - TEST ("Test Project"): unseeded — the shared-bundle shape, default "To do".
 *   - TST2 ("Test Project Two"): no "To do", custom states, default "Triage",
 *     its own Priority (default "P2"), and no Category field at all.
 *   - EMP ("Empty Project"): Status "Backlog"/"Active" with no configured default.
 * The fake refuses an unknown value with the recorded, unfilled template
 * ("An Open-type entity with the specified name ({1}) was not found"); whether
 * "Open" names the refused value is unconfirmed, and nothing here relies on it.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const CREATE_FIELDS = JSON.stringify({
  TST2: {
    Status: { values: ['Triage', 'Doing', 'Shipped'], default: 'Triage' },
    Priority: { values: ['P1', 'P2', 'P3'], default: 'P2' },
    Category: null,
    // No automatic timestamp field in this project.
    'Date time entered': null,
  },
  EMP: { Status: { values: ['Backlog', 'Active'], default: null } },
});
const RECORDED = 'An Open-type entity with the specified name ({1}) was not found';

const SUMMARY = '#ct-summary';
const PROJECT = '#ct-project';
const STATUS = '#ct-status';
const PRIORITY = '#ct-priority';
const CATEGORY = '#ct-category';
const CREATE = '[data-testid="task-create-btn"]';

async function optionTexts(page: Page, selector: string): Promise<string[]> {
  return page.locator(`${selector} option`).allTextContents();
}

async function createRequests(page: Page) {
  return page.evaluate(() => window.vermilian.debugGetCreateRequests!());
}

test.describe('Create task — per-project field discovery (VERM-115)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_YT_CREATE_FIELDS: CREATE_FIELDS });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await page.locator('[data-testid="nav-project"]').first().click();
    await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  async function openNewTask(project: string) {
    await page.locator('[data-testid="new-task-btn"]').click();
    await page.locator(SUMMARY).fill('A task');
    await page.locator(PROJECT).selectOption({ label: project });
  }

  test("New task offers the selected project's own values and default, never an assumed \"To do\"", async () => {
    await openNewTask('Test Project');
    await expect(page.locator(STATUS)).toHaveValue('To do');

    await page.locator(PROJECT).selectOption({ label: 'Test Project Two' });
    await expect(page.locator(STATUS)).toHaveValue('Triage');
    await expect.poll(() => optionTexts(page, STATUS)).toEqual(['—', 'Triage', 'Doing', 'Shipped']);
    await expect(page.locator(PRIORITY)).toHaveValue('P2');
    await expect(page.locator(CATEGORY)).toBeDisabled();
    await expect(page.locator(CATEGORY)).toHaveText('Not used in this project');

    await page.locator(STATUS).selectOption('Doing');
    await page.locator(CREATE).click();
    await expect(page.locator(SUMMARY)).toBeHidden();
    expect(await createRequests(page)).toEqual([
      // TST2 has no Date time entered field, so no timestamp is asked for.
      expect.objectContaining({ projectId: '0-e2', status: 'Doing', priority: 'P2', category: null, dateTimeEntered: false }),
    ]);
  });

  test('a project with no configured default leaves Status empty, and the POST omits it', async () => {
    await openNewTask('Empty Project');
    await expect.poll(() => optionTexts(page, STATUS)).toEqual(['—', 'Backlog', 'Active']);
    await expect(page.locator(STATUS)).toHaveValue('');
    await page.locator(CREATE).click();
    await expect(page.locator(SUMMARY)).toBeHidden();
    expect(await createRequests(page)).toEqual([expect.objectContaining({ projectId: '0-e4', status: null, dateTimeEntered: true })]);
  });

  test("a user's choice the next project lacks is cleared and flagged", async () => {
    await openNewTask('Test Project');
    await expect(page.locator(STATUS)).toHaveValue('To do');
    await page.locator(STATUS).selectOption('In Progress');
    await page.locator(PROJECT).selectOption({ label: 'Empty Project' });
    await expect(page.locator(STATUS)).toHaveValue('');
    await expect(page.getByTestId('ct-flag-status')).toHaveText('Status "In Progress" is not offered by this project. Cleared.');
  });

  test("a late answer for project A never populates project B's form", async () => {
    await openNewTask('Test Project');
    await expect(page.locator(STATUS)).toHaveValue('To do');
    // TST2's read is held; the user moves on to EMP before it answers.
    await page.evaluate(() => window.vermilian.debugSetFieldMetadataDelay!(2500, 'TST2'));
    await page.locator(PROJECT).selectOption({ label: 'Test Project Two' });
    await expect(page.locator(STATUS)).toBeDisabled();
    await expect(page.locator(CREATE)).toBeDisabled();
    await page.locator(PROJECT).selectOption({ label: 'Empty Project' });
    await expect.poll(() => optionTexts(page, STATUS)).toEqual(['—', 'Backlog', 'Active']);

    // Well after TST2's answer has arrived, EMP's form is unchanged.
    await page.waitForTimeout(3000);
    expect(await optionTexts(page, STATUS)).toEqual(['—', 'Backlog', 'Active']);
    await expect(page.locator(STATUS)).toHaveValue('');
    await expect(page.locator(PRIORITY)).not.toHaveValue('P2');
    await expect(page.locator(CATEGORY)).toBeEnabled();
    await expect(page.locator(PROJECT)).toHaveValue('0-e4');
  });

  test('a failed field read keeps the draft and offers Retry', async () => {
    await page.evaluate(() => window.vermilian.debugFailFieldMetadata!(1, 'TST2'));
    await openNewTask('Test Project Two');
    await page.locator('#ct-notes').fill('Keep me');
    await expect(page.getByTestId('ct-options-error')).toContainText('Simulated field read failure');
    await expect(page.locator(CREATE)).toBeDisabled();

    await page.getByTestId('ct-options-retry').click();
    await expect(page.getByTestId('ct-options-error')).toBeHidden();
    await expect(page.locator(STATUS)).toHaveValue('Triage');
    await expect(page.locator(SUMMARY)).toHaveValue('A task');
    await expect(page.locator('#ct-notes')).toHaveValue('Keep me');
    await expect(page.locator(CREATE)).toBeEnabled();
  });

  test('an invalid submission makes zero create requests, and names the field and value', async () => {
    const base = { projectId: '0-e2', summary: 'Direct', priority: null, category: null, dueDate: null, ticket: null, ticketLink: null, relatedLink: null, notes: null, repoUrl: null };
    const invalidStatus = await page.evaluate((a) => window.vermilian.createIssue({ ...a, status: 'To do' }), base);
    expect(invalidStatus.ok).toBe(false);
    expect(invalidStatus.rejected).toEqual([{ field: 'Status', value: 'To do' }]);
    expect(invalidStatus.error).toContain('Status "To do" is not a value in this project.');

    const absentField = await page.evaluate((a) => window.vermilian.createIssue({ ...a, status: null, category: 'OPS' }), base);
    expect(absentField.rejected).toEqual([{ field: 'Category', value: 'OPS' }]);

    const otherWorkspace = await page.evaluate((a) => window.vermilian.createIssue({ ...a, status: null, workspaceId: 'not-the-active-workspace' }), base);
    expect(otherWorkspace.ok).toBe(false);
    expect(otherWorkspace.error).toContain('active workspace changed');

    expect(await createRequests(page)).toEqual([]);
  });

  test("YouTrack's ambiguous {1} refusal is explained and offers a refresh", async () => {
    await openNewTask('Test Project');
    await expect(page.locator(STATUS)).toHaveValue('To do');
    await page.evaluate((m) => window.vermilian.debugSetNextCreateError!(m), RECORDED);
    await page.locator(CREATE).click();
    await expect(page.getByText('YouTrack rejected the request but did not identify the field.')).toBeVisible();
    await expect(page.getByText('({1})')).toHaveCount(0);

    await page.getByTestId('ct-refresh-options').click();
    await expect(page.locator(STATUS)).toHaveValue('To do');
    await page.locator(CREATE).click();
    await expect(page.locator(SUMMARY)).toBeHidden();
    expect(await createRequests(page)).toHaveLength(2);
  });

  test("AI create gives Claude the known project's values and clears an invalid suggestion", async () => {
    await page.locator('[data-testid="ai-create-btn"]').click();
    await page.locator('#ai-description').fill('Rotate the logs status: Open, category: OPS');
    await page.locator('[data-testid="ai-generate-btn"]').click();

    await expect(page.locator(SUMMARY)).toBeVisible();
    const calls = await page.evaluate(() => window.vermilian.debugGetClaudeCalls!());
    expect(calls.at(-1)?.allowedStatus).toEqual(['To do', 'In Progress', 'Waiting for IT', 'BLOCKED', 'Done', 'Wont do']);

    await expect(page.getByTestId('ct-flag-status')).toHaveText('AI suggested Status "Open", which this project does not offer. Cleared.');
    await expect(page.locator(STATUS)).toHaveValue('');
    await expect(page.locator(CATEGORY)).toHaveValue('OPS');

    await page.locator('[data-testid="ai-create-submit"]').click();
    await expect(page.locator(SUMMARY)).toBeHidden();
    expect(await createRequests(page)).toEqual([expect.objectContaining({ status: null, category: 'OPS' })]);
  });

  test('AI create validates against the project Claude identified before showing the review', async () => {
    await page.locator('[data-testid="ai-create-btn"]').click();
    await page.locator('#ai-description').fill('Archive old builds for Empty Project status: Done');
    await page.locator('[data-testid="ai-generate-btn"]').click();

    await expect(page.locator(SUMMARY)).toBeVisible();
    await expect(page.locator(PROJECT)).toHaveValue('0-e4');
    await expect(page.getByTestId('ct-flag-status')).toHaveText('AI suggested Status "Done", which this project does not offer. Cleared.');
    await expect.poll(() => optionTexts(page, STATUS)).toEqual(['—', 'Backlog', 'Active']);
    await expect(page.locator(STATUS)).toHaveValue('');
  });
});

// ─── Workspace binding (VERM-115 review) ─────────────────────────────────────
// Two YouTrack workspaces with their own YouTrack and Anthropic credential
// references. The fake YouTrack records which reference each project-field
// read came from (never a token), so a read on the wrong workspace's
// connection — or any read at all — is visible.

const ytWorkspace = (workspaceId: string, name: string, order: number, ytRef: string, aiRef: string, projectIds: string[]): WorkspaceDocument => ({
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId,
  name,
  order,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: ytRef },
  ai: { credentialRef: aiRef },
  folders: [{ id: `folder-${workspaceId}`, name: 'Projects', order: 0, parentId: null, projectIds }],
  boards: {},
  dismissals: {},
});

test.describe('Create task — bound to the originating workspace (VERM-115)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_YT_CREATE_FIELDS: CREATE_FIELDS,
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const d of [
      ytWorkspace('ws-bind-a', 'Workspace A', 0, 'youtrack-a', 'anthropic-a', ['0-e1', '0-e4']),
      ytWorkspace('ws-bind-b', 'Workspace B', 1, 'youtrack-b', 'anthropic-b', ['0-e2']),
    ]) {
      const r = await page.evaluate((doc) => window.vermilian.createWorkspaceArticle(doc), d);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(page.locator('[data-testid="workspace-switcher"]')).toBeVisible({ timeout: 15_000 });
    const r = await page.evaluate(() => window.vermilian.setActiveWorkspace('ws-bind-a'));
    expect(r.ok).toBe(true);
  });
  test.afterEach(async () => { await app.close(); });

  const metadataRequests = () => page.evaluate(() => window.vermilian.debugGetFieldMetadataRequests!());

  // Regression: on 113cf45 the lookup for the project Claude chose ran on
  // whichever workspace was active by then — B's connection — and the
  // answer was returned as if nothing had happened.
  test("switching from A to B while Claude answers cancels A's project lookup: B sees no metadata request and nothing is created", async () => {
    await page.evaluate(() => window.vermilian.debugSetClaudeExtractDelay!(1500));
    const metaBefore = (await metadataRequests()).length;
    const claudeBefore = (await page.evaluate(() => window.vermilian.debugGetClaudeCalls!())).length;

    const pending = page.evaluate(() =>
      window.vermilian.aiCreateTask({
        description: 'Archive old builds for Empty Project status: Backlog',
        projects: [{ id: '0-e1', name: 'Test Project' }, { id: '0-e4', name: 'Empty Project' }],
        projectId: '0-e1',
        workspaceId: 'ws-bind-a',
      }),
    );
    // Claude has the request; the user switches to B before it answers.
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.debugGetClaudeCalls!())).length).toBe(claudeBefore + 1);
    const switched = await page.evaluate(() => window.vermilian.setActiveWorkspace('ws-bind-b'));
    expect(switched.ok).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('active workspace changed');

    const reads = (await metadataRequests()).slice(metaBefore);
    // Only the known project's read before Claude, on A's own connection.
    expect(reads).toEqual([{ project: '0-e1', credentialRef: 'youtrack-a' }]);
    expect(reads.filter((r) => r.credentialRef === 'youtrack-b')).toEqual([]);
    expect(await createRequests(page)).toEqual([]);
  });

  test("manual create reads and creates on the origin workspace's own connection, and is refused after a switch", async () => {
    const base = { projectId: '0-e1', summary: 'Bound', status: null, priority: null, category: null, dueDate: null, ticket: null, ticketLink: null, relatedLink: null, notes: null, repoUrl: null };
    const metaBefore = (await metadataRequests()).length;
    const ok = await page.evaluate((a) => window.vermilian.createIssue({ ...a, workspaceId: 'ws-bind-a' }), base);
    expect(ok.ok).toBe(true);
    expect((await metadataRequests()).slice(metaBefore)).toEqual([{ project: '0-e1', credentialRef: 'youtrack-a' }]);

    await page.evaluate(() => window.vermilian.setActiveWorkspace('ws-bind-b'));
    const afterSwitch = (await metadataRequests()).length;
    const refused = await page.evaluate((a) => window.vermilian.createIssue({ ...a, workspaceId: 'ws-bind-a' }), base);
    expect(refused.ok).toBe(false);
    expect((await metadataRequests()).slice(afterSwitch).filter((r) => r.project === '0-e1')).toEqual([]);
    expect(await createRequests(page)).toHaveLength(1);
  });
});

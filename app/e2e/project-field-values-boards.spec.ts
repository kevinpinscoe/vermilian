/**
 * Boards, filters and the Priority Desk take each project's own values
 * (VERM-117, commit 2), against the fake projects in helpers/projectFieldEnv:
 * values outside the old fixed lists (Consider, Wont do, Fixed, P1-P3), and
 * "Consider" open in TEST but resolved in TST2.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchAppWithEnv } from './helpers/launch';
import { PROJECT_FIELD_ENV } from './helpers/projectFieldEnv';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function setStatus(page: Page, issueId: string, value: string) {
  const r = await page.evaluate((a) => window.vermilian.patchIssue(a), { issueId, field: 'status', value });
  expect(r.ok).toBe(true);
}

async function openProject(page: Page, name: string) {
  await page.locator('[data-testid="nav-project"]').filter({ hasText: name }).first().click();
  await page.waitForSelector('[data-testid="main-table"]', { timeout: 15_000 });
}

test.describe('Per-project values on boards and the Priority Desk (VERM-117)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv(PROJECT_FIELD_ENV);
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('the workspace Status filter offers values outside the old fixed list, and filters by them', async () => {
    await setStatus(page, 'TEST-1', 'Consider');
    await page.reload();
    await expect(tid(page, 'ws-filter-bar')).toBeVisible({ timeout: 15_000 });
    const pill = page.locator('[data-testid="ws-filter-pill"][data-section="Status"][data-value="Consider"]');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(tid(page, 'ws-issue-row')).toHaveCount(1);
    await expect(tid(page, 'ws-issue-row')).toHaveAttribute('data-issue-id', 'TEST-1');
  });

  test("a table chip editor offers its own project's values and keeps a saved value outside them", async () => {
    await openProject(page, 'Test Project Two');
    // TST2-1 has Priority "Normal", which TST2's own Priority [P1, P2, P3] does not list.
    const chip = page.locator('[data-testid="task-row"][data-task-id="0-e2-1"] [data-testid="chip-cell"][data-field="priority"]');
    await chip.click();
    const options = tid(page, 'chip-option');
    await expect(options).toHaveText(['Normal', 'P1', 'P2', 'P3']);
    await expect(page.locator('[data-testid="chip-option"][data-value="Normal"]')).toHaveAttribute('data-current-inactive', 'true');
    await page.locator('[data-testid="chip-option"][data-value="P1"]').click();
    await expect(chip).toHaveText('P1');

    // TEST's Status editor offers TEST's own workflow.
    await openProject(page, 'Test Project');
    await page.locator('[data-testid="task-row"][data-task-id="0-e1-1"] [data-testid="chip-cell"][data-field="status"]').click();
    await expect(tid(page, 'chip-option')).toHaveText(['To do', 'In Progress', 'Consider', 'Done', 'Wont do']);
  });

  test("Kanban collapses its project's resolved columns and its chips offer the project's values", async () => {
    await setStatus(page, 'TEST-2', 'Wont do');
    await setStatus(page, 'TEST-4', 'Consider');
    await page.reload();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openProject(page, 'Test Project');
    await page.locator('[data-testid="view-tab"][data-view-type="kanban"]').click();
    await expect(tid(page, 'kanban-board')).toBeVisible();
    // Wont do resolves in TEST, so it starts collapsed; Consider is open work.
    await expect(page.locator('[data-testid="kanban-column"][data-status="Wont do"]')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.locator('[data-testid="kanban-column"][data-status="Consider"]')).toHaveAttribute('data-collapsed', 'false');
    // Columns follow TEST's own order: To do, In Progress, Consider, …, Wont do.
    const columns = await tid(page, 'kanban-column').evaluateAll((cs) => cs.map((c) => c.getAttribute('data-status')));
    expect(columns.indexOf('Consider')).toBeLessThan(columns.indexOf('Wont do'));
    expect(columns.indexOf('In Progress')).toBeLessThan(columns.indexOf('Consider'));

    await openProject(page, 'Test Project Two');
    await page.locator('[data-testid="view-tab"][data-view-type="kanban"]').click();
    await page.locator('[data-testid="kanban-card"][data-issue-id="TST2-2"] [data-testid="chip-cell"][data-field="priority"]').click();
    await expect(tid(page, 'chip-option')).toHaveText(['Major', 'P1', 'P2', 'P3']);
  });

  test("Choose next excludes resolved tickets by each project's own resolution, and filters by open statuses", async () => {
    await setStatus(page, 'TEST-2', 'Wont do');     // resolved in TEST
    await setStatus(page, 'TST2-1', 'Fixed');       // resolved in TST2
    await setStatus(page, 'TEST-4', 'Consider');    // open in TEST
    await setStatus(page, 'TST2-2', 'Consider');    // resolved in TST2
    await page.reload();
    await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
    await tid(page, 'nav-priority-desk').click();
    await tid(page, 'priority-desk-mode-choose-next').click();
    await expect(tid(page, 'priority-desk-candidate-grid')).toBeVisible({ timeout: 15_000 });

    const ids = tid(page, 'priority-desk-candidate-id');
    await expect(ids.first()).toBeVisible();
    const shown = await ids.allTextContents();
    expect(shown).not.toContain('TEST-2');
    expect(shown).not.toContain('TST2-1');
    expect(shown).not.toContain('TST2-2');

    // Consider is open in TEST, so it is offered; Done, Wont do and Fixed resolve everywhere.
    const pills = page.locator('[data-testid="priority-desk-status-pill"]');
    const values = await pills.evaluateAll((ps) => ps.map((p) => p.getAttribute('data-value')));
    expect(values).toContain('Consider');
    for (const resolved of ['Done', 'Wont do', 'Fixed']) expect(values).not.toContain(resolved);

    await page.locator('[data-testid="priority-desk-status-pill"][data-value="Consider"]').click();
    await expect(ids).toHaveText(['TEST-4']);
  });
});

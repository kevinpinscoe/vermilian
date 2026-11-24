/**
 * The task detail dropdowns take the ticket's own project's values (VERM-117,
 * commit 3), against the fake projects in helpers/projectFieldEnv:
 *   - Affected host offers [FLDW, core] in TEST and [web1, mail1] in TST2.
 *   - A saved archived value ("retired-vm") survives opening the panel, shown
 *     as the current value with the active values as replacements.
 *   - A failed read keeps the current value visible and offers Retry.
 *   - A field the project lacks (TST2 has no Project health) is not editable.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchAppWithEnv } from './helpers/launch';
import { PROJECT_FIELD_ENV } from './helpers/projectFieldEnv';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const field = (page: Page, key: string) => page.locator(`[data-testid="task-detail-panel"] [data-field="${key}"]`);

async function patch(page: Page, issueId: string, f: string, value: string | null) {
  const r = await page.evaluate((a) => window.vermilian.patchIssue(a), { issueId, field: f, value });
  expect(r.ok).toBe(true);
}

async function openDetail(page: Page, idReadable: string) {
  await page.locator(`[data-testid="ws-issue-row"][data-issue-id="${idReadable}"]`).click();
  await expect(tid(page, 'task-detail-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="task-detail-panel"]')).toContainText(idReadable);
}

async function selectOptions(page: Page, key: string): Promise<string[]> {
  await field(page, key).locator('[data-testid="detail-select-button"]').click();
  return field(page, key).locator('[data-testid="detail-select"] option').allTextContents();
}

/** Leave an open dropdown without choosing (Escape would close the whole panel). */
async function closeSelect(page: Page, key: string) {
  await field(page, key).locator('[data-testid="detail-select"]').evaluate((el) => (el as HTMLElement).blur());
  await expect(field(page, key).locator('[data-testid="detail-select"]')).toHaveCount(0);
}

test.describe('Detail dropdowns use the ticket project\'s own values (VERM-117)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv(PROJECT_FIELD_ENV);
    page = await app.firstWindow();
    await expect(tid(page, 'ws-filter-bar')).toBeVisible({ timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test('Affected host offers different choices in two projects', async () => {
    await openDetail(page, 'TEST-1');
    expect(await selectOptions(page, 'affectedHost')).toEqual(['—', 'FLDW', 'core']);
    await closeSelect(page, 'affectedHost');

    await openDetail(page, 'TST2-1');
    expect(await selectOptions(page, 'affectedHost')).toEqual(['—', 'web1', 'mail1']);
    // And Status is TST2's own workflow.
    await closeSelect(page, 'affectedHost');
    expect(await selectOptions(page, 'status')).toEqual(['—', 'To do', 'In Progress', 'Consider', 'Fixed']);
  });

  test('a saved archived value survives opening the panel and is offered replacements', async () => {
    await patch(page, 'TEST-1', 'affectedHost', 'retired-vm');
    await page.reload();
    await expect(tid(page, 'ws-filter-bar')).toBeVisible({ timeout: 15_000 });
    await openDetail(page, 'TEST-1');

    const host = field(page, 'affectedHost');
    await expect(host.locator('[data-testid="detail-select-button"]')).toHaveText('retired-vm');
    await expect(host.locator('[data-testid="detail-select-inactive"]')).toHaveText('Archived');
    expect(await selectOptions(page, 'affectedHost')).toEqual(['—', 'retired-vm (archived)', 'FLDW', 'core']);
    await expect(host.locator('option', { hasText: 'retired-vm (archived)' })).toBeDisabled();

    // Opening the panel and the dropdown saved nothing: the stored value is unchanged.
    const stored = await page.evaluate(() => window.vermilian.getIssueDetail('TEST-1'));
    expect(stored.fields.affectedHost).toBe('retired-vm');

    // Choosing a replacement saves it.
    await host.locator('[data-testid="detail-select"]').selectOption('core');
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.getIssueDetail('TEST-1'))).fields.affectedHost).toBe('core');
  });

  test('a failed read keeps the current value visible and offers Retry', async () => {
    await patch(page, 'TST2-1', 'affectedHost', 'web1');
    await page.evaluate(() => window.vermilian.debugFailFieldMetadata!(20, 'TST2'));
    await page.reload();
    await expect(tid(page, 'ws-filter-bar')).toBeVisible({ timeout: 15_000 });
    await openDetail(page, 'TST2-1');

    const host = field(page, 'affectedHost');
    await expect(host.locator('[data-testid="detail-select-value"]')).toHaveText('web1');
    await expect(host.locator('[data-testid="detail-select-retry"]')).toBeVisible();
    await expect(host.locator('[data-testid="detail-select-button"]')).toHaveCount(0);

    await page.evaluate(() => window.vermilian.debugFailFieldMetadata!(0));
    await host.locator('[data-testid="detail-select-retry"]').click();
    await expect(host.locator('[data-testid="detail-select-button"]')).toHaveText('web1');
    expect(await selectOptions(page, 'affectedHost')).toEqual(['—', 'web1', 'mail1']);
  });

  test("a field the ticket's project does not have is shown, not editable", async () => {
    await openDetail(page, 'TST2-1');
    await expect(field(page, 'projectHealth').locator('[data-testid="detail-select-absent"]')).toBeVisible();
    await expect(field(page, 'projectHealth').locator('[data-testid="detail-select-button"]')).toHaveCount(0);
  });
});

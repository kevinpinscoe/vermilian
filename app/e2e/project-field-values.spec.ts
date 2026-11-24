/**
 * Per-project select-field values through the real IPC (VERM-117, commit 1).
 *
 * Two fake projects are seeded with different configurations:
 *   - TEST: Affected host [FLDW, core] plus an archived "retired-vm"; Status
 *     where "Consider" is open work.
 *   - TST2: Affected host [web1, mail1]; Status where "Consider" resolves
 *     the issue, and "Fixed" does too.
 * The read must return each project's own values, in its own order, and be
 * refused for a workspace that is not the active one.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchAppWithEnv } from './helpers/launch';
import { PROJECT_FIELD_ENV } from './helpers/projectFieldEnv';


test.describe('Project field values IPC (VERM-117)', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv(PROJECT_FIELD_ENV);
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });
  test.afterEach(async () => { await app.close(); });

  test("each project answers with its own values, archived and resolved ones marked", async () => {
    const test1 = await page.evaluate(() => window.vermilian.getProjectFieldValues({ workspaceId: '', project: 'TEST' }));
    const test2 = await page.evaluate(() => window.vermilian.getProjectFieldValues({ workspaceId: '', project: 'TST2' }));
    expect(test1).toMatchObject({ ok: true, project: 'TEST' });
    expect(test2).toMatchObject({ ok: true, project: 'TST2' });

    expect(test1.values?.fields.affectedHost).toEqual({ present: true, values: ['FLDW', 'core'], archived: ['retired-vm'], resolved: [] });
    expect(test2.values?.fields.affectedHost?.values).toEqual(['web1', 'mail1']);

    expect(test1.values?.fields.status?.resolved).toEqual(['Done', 'Wont do']);
    expect(test2.values?.fields.status?.resolved).toEqual(['Consider', 'Fixed']);
    expect(test1.values?.fields.status?.values).toContain('Consider');

    // The other dropdown fields come from the project too.
    expect(test1.values?.fields.projectHealth?.values).toEqual(['Green', 'Amber', 'Red']);
    expect(test1.values?.priorityOrder.length).toBeGreaterThan(0);
  });

  test('a workspace that is not active is refused, with no values', async () => {
    const r = await page.evaluate(() => window.vermilian.getProjectFieldValues({ workspaceId: 'not-the-active-workspace', project: 'TEST' }));
    expect(r).toMatchObject({ ok: false, refused: 'not-active', project: 'TEST' });
    expect(r.values).toBeUndefined();
  });
});

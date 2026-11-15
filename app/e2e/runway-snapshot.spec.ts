/**
 * Runway snapshot export (VERM-50): Settings → Advanced → "Export Runway
 * snapshot…" writes the WHOLE Runway metadata database to a file chosen in a
 * save dialog, through SQLite's online backup, in the packaged app.
 *
 * The native save dialog is stubbed in the main process (app.evaluate), so the
 * test controls the destination. The exported file is then opened here with
 * node:sqlite and checked: integrity_check, application_id, schema version,
 * and row counts matching what was written through the real IPC channels.
 * Nothing is written to Jira.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';

const RUNWAY_APPLICATION_ID = 0x5652_4d4c; // "VRML", see src/main/services/runwayDb.ts

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  return page;
}

// Replaces dialog.showSaveDialog in the main process. `filePath: null` means
// the user cancelled.
async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    const stub = async () => (target === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: target });
    (dialog as unknown as { showSaveDialog: typeof stub }).showSaveDialog = stub;
  }, filePath);
}

async function seed(page: Page): Promise<void> {
  // Two workspaces: the export must cover the whole database, not just the
  // active workspace.
  const writes: Array<[string, string, Record<string, unknown>]> = [
    ['workspace-default', 'jira:DEMO-101', { focusRank: 1, whyNow: 'Due Friday' }],
    ['workspace-default', 'jira:DEMO-102', { focus: true }],
    ['workspace-other', 'jira:DEMO-101', { focusRank: 2 }],
  ];
  for (const [workspaceId, issueId, patch] of writes) {
    const result = await page.evaluate(
      ([w, i, p]) => window.vermilian.runwayUpdate({ workspaceId: w, issueId: i, patch: p }),
      [workspaceId, issueId, patch] as const,
    );
    expect(result.ok).toBe(true);
  }
}

async function openAdvanced(page: Page): Promise<void> {
  await page.locator('[data-testid="topbar-settings-btn"]').click();
  await expect(page.getByRole('heading', { name: 'Advanced' })).toBeVisible();
}

function pragma(db: DatabaseSync, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

test.describe('Runway snapshot export', () => {
  let app: ElectronApplication | undefined;
  let outDir: string;

  test.beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-e2e-snapshot-'));
  });

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('exports a verified snapshot of the whole database', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);
    await seed(page);

    const dest = path.join(outDir, 'runway.sqlite');
    await stubSaveDialog(app, dest);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-export-btn"]').click();

    await expect(page.getByText(/Exported Runway snapshot \(3 entries, 0 dismissals\)/)).toBeVisible();
    expect(fs.readdirSync(outDir)).toEqual(['runway.sqlite']);

    const copy = new DatabaseSync(dest, { readOnly: true });
    try {
      expect(pragma(copy, 'integrity_check')).toBe('ok');
      expect(pragma(copy, 'application_id')).toBe(RUNWAY_APPLICATION_ID);
      expect(pragma(copy, 'user_version')).toBe(1);
      const count = (t: string) => (copy.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
      expect(count('runway_entry')).toBe(3);
      expect(count('dismissal')).toBe(0);
      const workspaces = copy
        .prepare('SELECT DISTINCT workspace_id FROM runway_entry ORDER BY workspace_id')
        .all()
        .map((r) => (r as { workspace_id: string }).workspace_id);
      expect(workspaces).toEqual(['workspace-default', 'workspace-other']);
    } finally {
      copy.close();
    }

    // The app keeps working on its live database after the export.
    const after = await page.evaluate(() =>
      window.vermilian.runwayUpdate({ workspaceId: 'workspace-default', issueId: 'jira:DEMO-103', patch: { focus: true } }),
    );
    expect(after.ok).toBe(true);
  });

  test('cancelling the dialog writes nothing', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);
    await seed(page);
    await stubSaveDialog(app, null);

    const result = await page.evaluate(() => window.vermilian.runwayExportSnapshot());
    expect(result).toEqual({ ok: true, canceled: true });
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test('an existing destination is refused and left untouched', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);
    await seed(page);

    const dest = path.join(outDir, 'existing.sqlite');
    fs.writeFileSync(dest, 'keep me');
    await stubSaveDialog(app, dest);
    await openAdvanced(page);
    await page.locator('[data-testid="runway-export-btn"]').click();

    await expect(page.getByText(/Runway snapshot not exported: A file already exists/)).toBeVisible();
    expect(fs.readFileSync(dest, 'utf8')).toBe('keep me');
    expect(fs.readdirSync(outDir)).toEqual(['existing.sqlite']);
  });
});

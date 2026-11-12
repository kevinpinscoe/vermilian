/**
 * Runway metadata store (VERM-37, ADR-0011 §6): a Jira issue's Focus, Focus
 * rank and Why now go to the local SQLite database in userData, so they
 * survive a relaunch of the same profile. Exercised through the real IPC
 * channels (window.vermilian.runwayGet / runwayUpdate); nothing is written to
 * Jira. The Priority Desk UI is wired to the store in a later change, so this
 * spec drives the API directly.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import type { RunwayPatch } from '../src/shared/runway';

const WS = 'workspace-default';

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  return page;
}

function runwayGet(page: Page, issueId: string) {
  return page.evaluate(
    ([workspaceId, id]) => window.vermilian.runwayGet({ workspaceId, issueId: id }),
    [WS, issueId] as const,
  );
}

function runwayUpdate(page: Page, issueId: string, patch: RunwayPatch) {
  return page.evaluate(
    ([workspaceId, id, p]) => window.vermilian.runwayUpdate({ workspaceId, issueId: id, patch: p }),
    [WS, issueId, patch] as const,
  );
}

test.describe('Runway metadata store', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('a Jira entry round-trips across a relaunch', async () => {
    const userDataDir = freshUserDataDir();

    app = await launchAppWithUserDataDir(userDataDir);
    let page = await ready(app);
    const saved = await runwayUpdate(page, 'jira:DEMO-101', { focusRank: 1, whyNow: 'Due Friday' });
    expect(saved).toEqual({
      ok: true,
      entry: { issueId: 'jira:DEMO-101', focus: true, focusRank: 1, whyNow: 'Due Friday' },
    });
    await app.close();
    app = undefined;

    expect(fs.existsSync(path.join(userDataDir, 'runway-metadata.sqlite'))).toBe(true);

    app = await launchAppWithUserDataDir(userDataDir);
    page = await ready(app);
    await expect.poll(() => runwayGet(page, 'jira:DEMO-101')).toEqual({
      ok: true,
      entry: { issueId: 'jira:DEMO-101', focus: true, focusRank: 1, whyNow: 'Due Friday' },
    });
  });

  test('refuses a rank another Jira issue holds, and a bare issue ID', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);

    expect((await runwayUpdate(page, 'jira:DEMO-101', { focusRank: 2 })).ok).toBe(true);
    const taken = await runwayUpdate(page, 'jira:DEMO-102', { focusRank: 2 });
    expect(taken).toMatchObject({ ok: false, code: 'rank-taken' });

    const bare = await runwayUpdate(page, 'DEMO-102', { focus: true });
    expect(bare.ok).toBe(false);
    expect(bare.ok === false && bare.error).toMatch(/Malformed namespaced issue ID/);
  });
});

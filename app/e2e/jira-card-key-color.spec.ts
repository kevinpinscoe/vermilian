/**
 * The ticket ID on a Jira card is green and readable in both themes (VERM-69),
 * against the fake YouTrack and fake Jira.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

// Fictional values only (ADR-0011 §10).
const YT: WorkspaceDocument = {
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
const JIRA: WorkspaceDocument = {
  ...YT,
  workspaceId: 'ws-e2ejg1',
  name: 'Jira colour',
  order: 1,
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
};

type Rgb = [number, number, number];

function parseRgb(css: string): Rgb {
  const m = css.match(/[\d.]+/g);
  if (!m || m.length < 3) throw new Error(`Unreadable colour: ${css}`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

async function keyColours(page: Page) {
  return page.locator('[data-testid="jira-card"][data-issue-key="DEMO-101"]').evaluate((card) => {
    const key = [...card.querySelectorAll('span')].find((s) => s.textContent === 'DEMO-101');
    if (!key) throw new Error('No ticket ID on the card');
    return { color: getComputedStyle(key).color, background: getComputedStyle(card).backgroundColor };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`the Jira card ticket ID is green and readable in the ${theme} theme`, async () => {
    const userData = freshUserDataDir();
    fs.writeFileSync(path.join(userData, 'app-config.json'), JSON.stringify({ youtrackUrl: 'http://e2e.local', theme }));
    const app = await launchAppWithUserDataDir(userData, { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
      for (const doc of [YT, JIRA]) {
        const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
        expect(r.ok).toBe(true);
      }
      await page.reload();
      await expect(tid(page, 'workspace-switcher')).toContainText('Workspace A', { timeout: 15_000 });
      await tid(page, 'workspace-switcher').click();
      await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: 'Jira colour' }).click();
      await expect(page.locator(`.${theme}-app-theme`).first()).toBeAttached();
      const card = page.locator('[data-testid="jira-card"][data-issue-key="DEMO-101"]');
      await expect(card).toBeVisible({ timeout: 15_000 });

      for (const state of ['normal', 'selected']) {
        if (state === 'selected') {
          await card.click();
          await expect(card).toHaveAttribute('aria-current', 'true');
        }
        const { color, background } = await keyColours(page);
        const [r, g, b] = parseRgb(color);
        expect(g, `${state}: ${color} is green`).toBeGreaterThan(r);
        expect(g, `${state}: ${color} is green`).toBeGreaterThan(b);
        expect(contrast(parseRgb(color), parseRgb(background)), `${state}: ${color} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await app.close();
    }
  });
}

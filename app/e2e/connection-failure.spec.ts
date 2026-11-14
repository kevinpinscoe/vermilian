/**
 * Recovering from a broken YouTrack connection.
 *
 * Regression for the case where a YouTrack instance is rebuilt and its tokens
 * invalidated. The app's `connected` check only asks whether a token FILE
 * exists, never whether it works — so a stale token routes the user to the
 * board rather than to Settings. The board is then empty, and the only Settings
 * button used to live in the left rail, which itself renders YouTrack-derived
 * data and fails. Net effect: an authentication failure removed the only route
 * to fixing authentication.
 *
 * These tests assert the two escape hatches: a top-bar gear that depends on no
 * remote data, and a banner that explains the failure and offers the fix.
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { freshUserDataDir, launchAppWithRevokedToken, launchAppWithUserDataDir } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

test.describe('Broken YouTrack connection', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithRevokedToken();
    page = await app.firstWindow();
    // The app considers itself connected (a token file exists), so it renders
    // the shell. Wait on the top bar rather than on any project-derived node —
    // no projects will ever load here.
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('shows a banner naming the token as the problem', async () => {
    const banner = page.locator('[data-testid="connection-error-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/rejected the stored token/i);
    // Must point at the remedy, not just state the failure.
    await expect(banner).toContainText(/Settings/);
  });

  test('the banner offers a route to Settings', async () => {
    await page.locator('[data-testid="connection-error-banner"]')
      .getByRole('button', { name: 'Open Settings' })
      .click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connection' })).toBeVisible();
  });

  test('the top-bar gear reaches Settings even though the rail failed', async () => {
    // The specific trap: this must work without depending on the left rail,
    // which cannot render its project tree when YouTrack rejects the token.
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('Settings opened this way can be closed, returning to the board', async () => {
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Back to the shell, with the banner still up since nothing was fixed.
    await expect(page.locator('[data-testid="connection-error-banner"]')).toBeVisible();
  });
});

/**
 * A revoked or expired Jira token (VERM-40). VERMILIAN_E2E_JIRA_401 makes the
 * fake Jira reject the workspace's token unless its credential reference is
 * given a working source, as a user would after replacing the token. The
 * Jira workspace shows a reconnect state; the YouTrack workspace and the
 * top-bar Settings gear keep working. Fictional values only (ADR-0011 §10).
 */
const YT_WS: WorkspaceDocument = {
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
const JIRA_WS: WorkspaceDocument = {
  ...YT_WS,
  workspaceId: 'ws-e2ejr1',
  name: 'Jira work',
  order: 1,
  // Not jira-1, which is the legacy Settings Jira token (tested below).
  backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-2' },
  folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO', 'OPS'] }],
};
const LEGACY_JIRA_WS: WorkspaceDocument = {
  ...JIRA_WS,
  workspaceId: 'ws-e2ejr2',
  name: 'Jira legacy',
  order: 2,
  backend: { ...(JIRA_WS.backend as Extract<WorkspaceDocument['backend'], { kind: 'jira' }>), credentialRef: 'jira-1' },
};

test.describe('Revoked Jira token — per-workspace storage (e2e gate)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  const switcher = () => page.locator('[data-testid="workspace-switcher"]');
  const choose = async (name: string) => {
    await switcher().click();
    await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
    await expect(switcher()).toContainText(name);
  };

  test.beforeEach(async () => {
    userDataDir = freshUserDataDir();
    app = await launchAppWithUserDataDir(userDataDir, {
      VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace',
      VERMILIAN_E2E_JIRA_401: '1',
    });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const doc of [YT_WS, JIRA_WS, LEGACY_JIRA_WS]) {
      const r = await page.evaluate((d) => window.vermilian.createWorkspaceArticle(d), doc);
      expect(r.ok).toBe(true);
    }
    await page.reload();
    await expect(switcher()).toContainText('Workspace A', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('the Jira workspace shows the reconnect state; YouTrack and Settings keep working', async () => {
    await choose('Jira work');
    const reconnect = page.locator('[data-testid="jira-reconnect"]');
    await expect(reconnect).toBeVisible();
    await expect(reconnect).toHaveAttribute('data-reason', 'unauthorized');
    await expect(reconnect).toContainText('Jira rejected this workspace’s token');
    await expect(page.locator('[data-testid="jira-reconnect-ref"]')).toHaveText('jira-2');
    // jira-2's status is established (nothing configured), so a new token can
    // be entered here.
    await expect(page.locator('[data-testid="jira-reconnect-advice"]')).toHaveAttribute('data-status', 'ready');
    await expect(page.locator('[data-testid="jira-reconnect-token"]')).toBeVisible();
    await expect(page.locator('[data-testid="jira-reconnect-save"]')).toBeDisabled();
    // The board's columns and the bare error line are replaced, not shown beside it.
    await expect(page.locator('[data-testid="jira-column"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="jira-board-error"]')).toHaveCount(0);

    // The detail IPC reports the same reason, so the panel can say so.
    const detail = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssueDetail({ workspaceId: 'ws-e2ejr1', issueKey: 'DEMO-101' }));
    expect(detail).toMatchObject({ ok: false, reason: 'unauthorized', credentialRef: 'jira-2' });
    // A refusal by Vermilian is not mistaken for a token problem.
    const other = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejr1', projectKey: 'NOPE' }));
    expect(other).toMatchObject({ ok: false });

    // The top-bar gear stays reachable and returns to the reconnect state.
    await page.locator('[data-testid="topbar-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(reconnect).toBeVisible();

    // The YouTrack workspace is unaffected.
    await choose('Workspace A');
    await expect(page.locator('[data-testid="workspace-board"]')).toBeVisible();
    await expect(page.locator('[data-testid="workspace-board"]')).toContainText('TEST-1');
    await expect(reconnect).toHaveCount(0);
  });

  test('replacing the token at its source and trying again reconnects the board', async () => {
    await choose('Jira work');
    await expect(page.locator('[data-testid="jira-reconnect"]')).toBeVisible();

    // The user puts a new token where jira-1 reads it from (a file source).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verm-e2e-jira-'));
    const file = path.join(dir, 'jira-token');
    fs.writeFileSync(file, 'e2e-replaced-jira-token\n', { mode: 0o600 });
    const set = await page.evaluate((f) => window.vermilian.setCredentialRefSources('jira-2', { command: '', file: f }), file);
    expect(set.ok).toBe(true);

    await page.locator('[data-testid="jira-reconnect-retry"]').click();
    await expect(page.locator('[data-testid="jira-reconnect"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="jira-card"]')).toHaveCount(3);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A configured source that fails stops resolution, under e2e as on a real
  // host: a credential failure, never the fake token (fail-closed).
  test('an unreadable file source is a credential failure; the advice says to fix the file', async () => {
    const set = await page.evaluate(() => window.vermilian.setCredentialRefSources('jira-2', { command: '', file: '/nonexistent/verm-e2e-jira-token' }));
    expect(set.ok).toBe(true);
    await choose('Jira work');
    const reconnect = page.locator('[data-testid="jira-reconnect"]');
    await expect(reconnect).toHaveAttribute('data-reason', 'credential');
    await expect(reconnect).toContainText('not available here');
    await expect(page.locator('[data-testid="jira-reconnect-advice"]')).toContainText('reads its token from a file');
    await expect(page.locator('[data-testid="jira-reconnect-token"]')).toHaveCount(0);
    const issues = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejr1', projectKey: 'DEMO' }));
    expect(issues).toMatchObject({ ok: false, reason: 'credential', credentialRef: 'jira-2' });
  });

  test('a failing command source is a credential failure, not a fake-token fallback', async () => {
    const set = await page.evaluate(() => window.vermilian.setCredentialRefSources('jira-2', { command: 'false', file: '' }));
    expect(set.ok).toBe(true);
    await choose('Jira work');
    await expect(page.locator('[data-testid="jira-reconnect"]')).toHaveAttribute('data-reason', 'credential');
    await expect(page.locator('[data-testid="jira-reconnect-advice"]')).toContainText('reads its token from a command');
    await expect(page.locator('[data-testid="jira-reconnect-token"]')).toHaveCount(0);
  });

  test('a stored token that cannot be decrypted is a credential failure', async () => {
    // A stored blob that is not a valid encrypted credential.
    fs.mkdirSync(path.join(userDataDir, 'credentials'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'credentials', 'ref-jira-2.bin'), 'not-an-encrypted-credential');
    await choose('Jira work');
    await expect(page.locator('[data-testid="jira-reconnect"]')).toHaveAttribute('data-reason', 'credential');
    const issues = await page.evaluate(() => window.vermilian.getWorkspaceJiraIssues({ workspaceId: 'ws-e2ejr1', projectKey: 'DEMO' }));
    expect(issues).toMatchObject({ ok: false, reason: 'credential' });
    if (!issues.ok) expect(issues.message).not.toContain('not-an-encrypted-credential');
  });

  test('the status IPC reports configuration only, and refuses a malformed reference', async () => {
    const fresh = await page.evaluate(() => window.vermilian.getCredentialRefStatus('jira-2'));
    expect(fresh).toEqual({
      ok: true,
      status: { credentialRef: 'jira-2', legacy: false, commandConfigured: false, fileConfigured: false, blobPresent: false, selected: null },
    });
    const legacy = await page.evaluate(() => window.vermilian.getCredentialRefStatus('jira-1'));
    expect(legacy).toMatchObject({ ok: true, status: { legacy: true } });
    const bad = await page.evaluate(() => window.vermilian.getCredentialRefStatus('../etc'));
    expect(bad.ok).toBe(false);
  });

  test('saving a typed token either reconnects or says why it could not be stored', async () => {
    await choose('Jira work');
    await page.locator('[data-testid="jira-reconnect-token"]').fill('e2e-typed-jira-token');
    await page.locator('[data-testid="jira-reconnect-save"]').click();
    // Whether this host offers encrypted storage decides which; neither is silent.
    await expect
      .poll(async () =>
        (await page.locator('[data-testid="jira-card"]').count()) === 3 ||
        (await page.locator('[data-testid="jira-reconnect-save-error"]').count()) === 1,
      )
      .toBe(true);
  });

  test('the legacy Settings Jira token (jira-1) is replaced in Settings, reached from the reconnect state', async () => {
    await choose('Jira legacy');
    await expect(page.locator('[data-testid="jira-reconnect"]')).toBeVisible();
    await expect(page.locator('[data-testid="jira-reconnect-ref"]')).toHaveText('jira-1');
    await expect(page.locator('[data-testid="jira-reconnect-advice"]')).toContainText('Jira token from Settings');
    await expect(page.locator('[data-testid="jira-reconnect-token"]')).toHaveCount(0);
    await page.locator('[data-testid="jira-reconnect-open-settings"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

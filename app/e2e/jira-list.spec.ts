/**
 * Read-only Jira list (VERM-21): the top-bar Jira button opens a list of the
 * open issues assigned to me, rendering key, summary, status and priority
 * from the in-memory fake Jira (src/main/api/fakeJira.ts FAKE_JIRA_ISSUES).
 * Without a Jira profile in YouTrack it says Jira is not set up.
 */

import { test, expect, Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchApp, launchAppWithEnv } from './helpers/launch';

const PROFILE = JSON.stringify({
  version: 1,
  profile: { siteUrl: 'https://example.atlassian.net', email: 'me@example.com', cloudId: '' },
});

async function openJiraList(page: Page) {
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  await page.locator('[data-testid="jira-list-btn"]').click();
  await expect(page.locator('[data-testid="jira-list-body"]')).toBeVisible();
}

test.describe('Jira list', () => {
  let app: ElectronApplication;

  test.afterEach(async () => { await app.close(); });

  test('renders key, summary, status and priority from the fake Jira', async () => {
    app = await launchAppWithEnv({ VERMILIAN_E2E_JIRA_ARTICLE_CONTENT: PROFILE });
    const page = await app.firstWindow();
    await openJiraList(page);

    const rows = page.locator('[data-testid="jira-list-row"]');
    await expect(rows).toHaveCount(3);

    const first = page.locator('[data-testid="jira-list-row"][data-issue-key="DEMO-101"]');
    await expect(first.getByRole('button', { name: 'DEMO-101' })).toBeVisible();
    await expect(first.locator('[data-testid="jira-list-summary"]')).toHaveText('Rotate the staging database credentials');
    await expect(first.locator('[data-testid="jira-list-status"]')).toHaveText('In Progress');
    await expect(first.locator('[data-testid="jira-list-priority"]')).toHaveText('High');

    const second = page.locator('[data-testid="jira-list-row"][data-issue-key="DEMO-102"]');
    await expect(second.locator('[data-testid="jira-list-status"]')).toHaveText('To Do');
    await expect(second.locator('[data-testid="jira-list-priority"]')).toHaveText('Medium');

    // No priority field on the project → a dash, not a blank cell.
    const third = page.locator('[data-testid="jira-list-row"][data-issue-key="OPS-7"]');
    await expect(third.locator('[data-testid="jira-list-priority"]')).toHaveText('—');

    // Read-only: nothing in the list is editable.
    await expect(page.locator('[data-testid="jira-list-body"] input, [data-testid="jira-list-body"] textarea')).toHaveCount(0);
  });

  test('says Jira is not set up when YouTrack holds no Jira profile', async () => {
    app = await launchApp();
    const page = await app.firstWindow();
    await openJiraList(page);

    await expect(page.locator('[data-testid="jira-list-not-configured"]')).toContainText('Jira is not set up');
    // Not by label: the top-bar and rail gears are also "Open Settings".
    await page.locator('[data-testid="jira-list-open-settings-btn"]').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

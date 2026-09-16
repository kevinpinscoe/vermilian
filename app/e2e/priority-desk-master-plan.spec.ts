/**
 * Priority Desk — Master Plan (VERM-7, ADR-0008). Covers the
 * _vermilian-master-plan discovery/parse/display surface added on top of the
 * native Epic → Subtask context already tested in priority-desk.spec.ts:
 * outcome display on a Now-mode card, an Epic with no matching outcome, a
 * task with no Epic at all, and the persistent diagnostic banner for
 * duplicate articles / malformed content / a missing article (a supported
 * empty state, not an error).
 *
 * Fake YouTrack fixtures used: TEST-3 (isEpic: true, parent of TEST-1/
 * TEST-2), TEST-4 (an ordinary non-Epic fixture, parent of nothing, no
 * parent of its own), TEST-5 (child of TEST-4) — see fakeYouTrack.ts.
 */

import { test, expect, Page } from '@playwright/test';
import {
  launchApp,
  launchAppWithMasterPlan,
  launchAppWithDuplicateMasterPlan,
} from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

const OUTCOME_FOR_TEST_3 =
  '## Build the Priority Desk\n' +
  '- Active epics: TEST-3\n' +
  '- Success measure: A trusted, human-controlled workflow for selecting current work.\n' +
  '- Target window: 2026 Q3\n' +
  '- Risks / dependencies: none noted\n';

const MALFORMED_CONTENT = 'This article has no outcome sections at all — just prose.';

async function openPriorityDesk(page: Page) {
  await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-priority-desk"]').click();
  await page.waitForSelector('[data-testid="priority-desk"]', { timeout: 15_000 });
}

// Same "external edit" simulation priority-desk.spec.ts uses: set rank
// through IPC directly, then reload so the desk's queries re-fetch fresh.
async function rankIssue(page: Page, issueId: string, rank: 1 | 2 | 3) {
  await page.evaluate(
    async ({ issueId, rank }) => {
      await window.vermilian.patchIssue({ issueId, field: 'focus', value: 'Yes' });
      await window.vermilian.patchIssue({ issueId, field: 'focusRank', value: rank });
    },
    { issueId, rank },
  );
  await page.reload();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
}

test.describe('Priority Desk — Master Plan outcome display', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithMasterPlan(OUTCOME_FOR_TEST_3);
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    // TEST-1 → Now (parent Epic TEST-3, which the article references).
    // TEST-5 → Next (parent Epic TEST-4, which the article does NOT reference).
    // TEST-4 → Then (no parent Epic at all).
    await rankIssue(page, '0-e1-1', 1);
    await rankIssue(page, '0-e1-5', 2);
    await rankIssue(page, '0-e1-4', 3);
    await openPriorityDesk(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('a card whose parent Epic matches an outcome shows the outcome name', async () => {
    const card = page.locator('[data-testid="priority-desk-card-0-e1-1"]');
    await expect(card.locator('[data-testid="priority-desk-card-epic-0-e1-1"]')).toContainText('TEST-3');
    await expect(card.locator('[data-testid="priority-desk-card-outcome-0-e1-1"]')).toContainText(
      'Build the Priority Desk',
    );
  });

  test('a card whose parent Epic has no matching outcome shows the Epic line unchanged, no outcome line', async () => {
    const card = page.locator('[data-testid="priority-desk-card-0-e1-5"]');
    await expect(card.locator('[data-testid="priority-desk-card-epic-0-e1-5"]')).toContainText('TEST-4');
    await expect(card.locator('[data-testid="priority-desk-card-outcome-0-e1-5"]')).toHaveCount(0);
  });

  test('a card with no parent Epic renders with no Epic or outcome line at all', async () => {
    const card = page.locator('[data-testid="priority-desk-card-0-e1-4"]');
    await expect(card.locator('[data-testid="priority-desk-card-epic-0-e1-4"]')).toHaveCount(0);
    await expect(card.locator('[data-testid="priority-desk-card-outcome-0-e1-4"]')).toHaveCount(0);
  });

  test('a cleanly loaded, unambiguous Master Plan shows no diagnostic banner', async () => {
    await expect(page.locator('[data-testid="master-plan-diagnostic-banner"]')).toHaveCount(0);
  });
});

test.describe('Priority Desk — Master Plan diagnostics', () => {
  test('no _vermilian-master-plan article is a normal, banner-free empty state', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openPriorityDesk(page);
    await expect(page.locator('[data-testid="master-plan-diagnostic-banner"]')).toHaveCount(0);
    // The rest of the desk still works with no article configured.
    await expect(page.locator('[data-testid="priority-desk-mode-switch"]')).toBeVisible();
    await app.close();
  });

  test('duplicate _vermilian-master-plan articles show a persistent, dismissible warning', async () => {
    const app = await launchAppWithDuplicateMasterPlan();
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openPriorityDesk(page);

    const banner = page.locator('[data-testid="master-plan-diagnostic-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Multiple Master Plan articles found');

    await page.locator('[data-testid="master-plan-diagnostic-dismiss"]').click();
    await expect(banner).toHaveCount(0);

    // The rest of Priority Desk is unaffected by the diagnostic.
    await expect(page.locator('[data-testid="priority-desk-mode-switch"]')).toBeVisible();
    await app.close();
  });

  test('an article with no parseable outcome sections shows a persistent warning', async () => {
    const app = await launchAppWithMasterPlan(MALFORMED_CONTENT);
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openPriorityDesk(page);

    const banner = page.locator('[data-testid="master-plan-diagnostic-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Master Plan article could not be read');

    // Ordinary Now-mode operation is unaffected by the malformed article.
    await expect(page.locator('[data-testid="priority-desk-mode-switch"]')).toBeVisible();
    await app.close();
  });
});

/**
 * Priority Desk — "Ask for recommendation" (VERM-8, docs/requirements.md §
 * Priority Desk "Ask for recommendation"). Covers the outcome selector, the
 * bounded recommendation call against the fake Claude/YouTrack backends, the
 * three confirmation actions' exact field writes, the audit-comment gate
 * (posted only after a ranked recommendation AND a chosen action), and the
 * clarification-only path (no actions offered, no audit comment, no field
 * changed).
 *
 * Fake fixtures (src/main/api/fakeYouTrack.ts): the default Choose-next
 * candidate order is [TEST-1, TEST-2, TEST-6, TEST-4, TST2-2, INB-1, TEST-5]
 * (see priority-desk-choose-next.spec.ts). fakeClaude.ts's getRecommendation
 * ranks the first three ids it's given and alternates the next two, in the
 * order it receives them — so with the full seven-candidate set the ranked
 * top three are TEST-1/TEST-2/TEST-6 and the alternates are TEST-4/TST2-2.
 */

import { test, expect, Page } from '@playwright/test';
import { launchApp, launchAppWithEnv } from './helpers/launch';
import type { ElectronApplication } from '@playwright/test';

const OUTCOME_CONTENT =
  '## Ship the desk\n' +
  '- Active epics: TEST-3\n' +
  '- Success measure: A trusted, human-controlled workflow for selecting current work.\n' +
  '- Target window: 2026 Q3\n' +
  '- Risks / dependencies: none noted\n';

async function openChooseNext(page: Page) {
  await page.waitForSelector('[data-testid="nav-priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="nav-priority-desk"]').click();
  await page.waitForSelector('[data-testid="priority-desk"]', { timeout: 15_000 });
  await page.locator('[data-testid="priority-desk-mode-choose-next"]').click();
  await page.waitForSelector('[data-testid="priority-desk-choose-next"]', { timeout: 15_000 });
}

function getPostedComments(page: Page) {
  return page.evaluate(() => window.vermilian.debugGetPostedComments?.() ?? []);
}

test.describe('Priority Desk — Ask for recommendation, no Master Plan loaded', () => {
  test('no outcome selector, and the button stays disabled with nothing to select', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);

    await expect(page.locator('[data-testid="priority-desk-outcome-selector"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-ask-recommendation"]')).toBeDisabled();
    await app.close();
  });
});

test.describe('Priority Desk — Ask for recommendation, Master Plan loaded', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchAppWithEnv({ VERMILIAN_E2E_MASTER_PLAN_CONTENT: OUTCOME_CONTENT });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);
  });
  test.afterEach(async () => { await app.close(); });

  test('the outcome selector appears; the button is disabled until an outcome is selected', async () => {
    const selector = page.locator('[data-testid="priority-desk-outcome-selector"]');
    await expect(selector).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-outcome-pill"]')).toHaveText('Ship the desk');
    await expect(page.locator('[data-testid="priority-desk-ask-recommendation"]')).toBeDisabled();

    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await expect(page.locator('[data-testid="priority-desk-ask-recommendation"]')).toBeEnabled();
  });

  test('asking for a recommendation renders a ranked panel with evidence, from the fake backend', async () => {
    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await page.locator('[data-testid="priority-desk-ask-recommendation"]').click();

    const panel = page.locator('[data-testid="priority-desk-recommendation-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="priority-desk-recommendation-ranked-0-e1-1"]')).toContainText('TEST-1');
    await expect(page.locator('[data-testid="priority-desk-recommendation-ranked-0-e1-1"]')).toContainText('Outcome:');
    await expect(page.locator('[data-testid="priority-desk-recommendation-ranked-0-e1-2"]')).toContainText('TEST-2');
    await expect(page.locator('[data-testid="priority-desk-recommendation-ranked-0-e1-6"]')).toContainText('TEST-6');
    await expect(page.locator('[data-testid="priority-desk-recommendation-alternate-0-e1-4"]')).toContainText('TEST-4');

    // No audit comment exists yet — nothing has been confirmed.
    expect(await getPostedComments(page)).toEqual([]);
  });

  test('Apply to desk assigns Focus rank 1/2/3 to the ranked top three, and only after that choice posts the audit comment on the top-ranked issue', async () => {
    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await page.locator('[data-testid="priority-desk-ask-recommendation"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toBeVisible({ timeout: 10_000 });

    expect(await getPostedComments(page)).toEqual([]);

    await page.locator('[data-testid="priority-desk-recommendation-apply"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toHaveCount(0, { timeout: 10_000 });

    await page.locator('[data-testid="priority-desk-mode-now"]').click();
    await expect(page.locator('[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-0-e1-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-next"] [data-testid="priority-desk-card-0-e1-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="priority-desk-slot-then"] [data-testid="priority-desk-card-0-e1-6"]')).toBeVisible();

    const comments = await getPostedComments(page);
    expect(comments).toHaveLength(1);
    expect(comments[0].issueId).toBe('0-e1-1');
    expect(comments[0].text).toContain('Apply to desk');
    expect(comments[0].text).toContain('TEST-1');
  });

  test('Star only sets Focus=Yes on the ranked top three with no rank assigned', async () => {
    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await page.locator('[data-testid="priority-desk-ask-recommendation"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="priority-desk-recommendation-star"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toHaveCount(0, { timeout: 10_000 });

    const card = page.locator('[data-testid="priority-desk-candidate-0-e1-1"]');
    await expect(card.locator('[data-testid="focus-star-0-e1-1"]')).toHaveClass(/starActive/);
    await expect(card.locator('[data-testid="focus-rank-badge-0-e1-1"]')).toHaveText('–');

    const comments = await getPostedComments(page);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('Star only');
  });

  test('Keep my order makes no field changes but still posts the audit comment', async () => {
    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await page.locator('[data-testid="priority-desk-ask-recommendation"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid="priority-desk-recommendation-keep"]').click();
    await expect(page.locator('[data-testid="priority-desk-recommendation-panel"]')).toHaveCount(0, { timeout: 10_000 });

    // TEST-1 is unaffected — still an ordinary, unfocused candidate.
    const card = page.locator('[data-testid="priority-desk-candidate-0-e1-1"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="focus-star-0-e1-1"]')).not.toHaveClass(/starActive/);

    const comments = await getPostedComments(page);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('Keep my order');
    expect(comments[0].text).toContain('no fields changed');
  });
});

test.describe('Priority Desk — Ask for recommendation, clarification-only path', () => {
  test('shows the question, offers no confirmation actions, and never posts an audit comment', async () => {
    const app = await launchAppWithEnv({
      VERMILIAN_E2E_MASTER_PLAN_CONTENT: OUTCOME_CONTENT,
      VERMILIAN_E2E_RECOMMENDATION_CLARIFICATION: '1',
    });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    await openChooseNext(page);

    await page.locator('[data-testid="priority-desk-outcome-pill"]').click();
    await page.locator('[data-testid="priority-desk-ask-recommendation"]').click();

    const clarification = page.locator('[data-testid="priority-desk-recommendation-clarification"]');
    await expect(clarification).toBeVisible({ timeout: 10_000 });
    await expect(clarification).toContainText('Fake adviser');

    await expect(page.locator('[data-testid="priority-desk-recommendation-apply"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-recommendation-star"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="priority-desk-recommendation-keep"]')).toHaveCount(0);

    expect(await getPostedComments(page)).toEqual([]);

    // No field changed either — TEST-1 is still an ordinary candidate.
    const card = page.locator('[data-testid="priority-desk-candidate-0-e1-1"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="focus-star-0-e1-1"]')).not.toHaveClass(/starActive/);

    await app.close();
  });
});

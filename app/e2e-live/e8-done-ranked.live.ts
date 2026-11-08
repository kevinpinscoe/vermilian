/**
 * E8 — a ranked issue that is completed. Checklist: § E8, finding K6.
 *
 * Decided 2026-11-08 (VERM-10, requirements "Completed issues and focus"):
 * once Done and after a restart, the issue leaves Now/Next/Then, Blocked
 * focused work and Needs attention, while its stored Focus and Focus rank
 * stay exactly as they were. Rank reuse and reopening are E9 and E10.
 */

import { test, expect } from './harness/fixture';
import { openDailyReview, openDesk, openProject, textOrNull } from './harness/ui';
import { setFields } from './harness/server';

test('E8 — completing a ranked issue: desk, Daily Review and stored rank', async ({ live }) => {
  live.expected('After setting the Now issue to Done in the UI and restarting, it is not a card on the Priority Desk and not in Daily Review\'s focus slots, Blocked focused work or Needs attention.');
  live.expected('Its stored Focus (Yes) and Focus rank (1) are unchanged on the server: completion is not a focus edit.');

  const issue = await live.fixture('E8 finishing');
  await setFields(live.verifier, issue.id, { focus: 'Yes', focusRank: 1, whyNow: 'Live harness reason E8' });
  await live.server('before', [issue.id]);

  const page = await live.app.launch();
  await openDesk(page);
  await expect(page.locator(`[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-${issue.id}"]`)).toBeVisible();

  // Complete it through the UI: the Status chip on the board row.
  await openProject(page, live.project.name);
  await page.locator(`[data-task-id="${issue.id}"] [data-testid="chip-cell"][data-field="status"]`).first().click();
  await expect(page.locator('[data-testid="chip-dropdown"]')).toBeVisible();
  await page.locator(`[data-testid="chip-option"][data-value="${live.settings.doneState}"]`).click();
  await expect.poll(async () => (await live.read(issue.id)).status).toBe(live.settings.doneState);
  const done = await live.server('after-done', [issue.id]);
  live.observe('stored values right after Done', done[issue.idReadable]);

  await live.app.close('E8 restart');
  const page2 = await live.app.launch();
  await openDesk(page2);
  const nowSlotText = await textOrNull(page2, '[data-testid="priority-desk-slot-now"]');
  live.observe('desk Now slot after restart', nowSlotText);
  live.observe('desk repair banner present', await page2.locator('[data-testid="focus-rank-repair-banner"]').count() > 0);
  await live.app.screenshot('e8-desk');

  await openDailyReview(page2);
  const reviewNow = await textOrNull(page2, '[data-testid="daily-review-slot-now"]');
  const needsAttention = await textOrNull(page2, '[data-testid="daily-review-needs-attention"]');
  const blocked = await textOrNull(page2, '[data-testid="daily-review-blocked"]');
  const completed = await textOrNull(page2, '[data-testid="daily-review-completed"]');
  live.observe('Daily Review Now slot', reviewNow);
  live.observe('Daily Review Blocked focused work', blocked);
  live.observe('Daily Review Recently completed (eligible, not asserted)', completed);
  live.observe('Daily Review Needs attention', needsAttention);
  await live.app.screenshot('e8-daily-review');

  const stored = await live.server('after-restart', [issue.id]);
  live.observe('stored values after restart', stored[issue.idReadable]);

  // Checklist assertions, made after every observation is captured so a
  // failure still leaves the full picture in the report.
  await expect.soft(page2.locator(`[data-testid="daily-review-slot-issue-${issue.id}"]`), 'Daily Review must not show the Done issue in a focus slot').toHaveCount(0);
  expect.soft(needsAttention ?? '', 'Needs attention must not list the Done issue').not.toContain(issue.idReadable);
  expect.soft(blocked ?? '', 'Blocked focused work must not list the Done issue').not.toContain(issue.idReadable);
  expect.soft(stored[issue.idReadable], 'stored Focus and Focus rank must be unchanged').toMatchObject({ focus: 'Yes', focusRank: 1 });
  await page2.locator('#daily-review-modal').getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page2.locator('[data-testid="daily-review-body"]')).toHaveCount(0);
  await openDesk(page2);
  await expect.soft(page2.locator(`[data-testid="priority-desk-card-${issue.id}"]`), 'the desk must not show the Done issue as a card').toHaveCount(0);
});

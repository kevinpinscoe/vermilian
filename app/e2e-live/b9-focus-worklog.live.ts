/**
 * B9 — Start focus uses the timer, and Stop & log posts a real worklog.
 * Checklist: § B9, finding K2.
 *
 * Two cases:
 * - success: the harness project has time tracking enabled. The worklog the
 *   app reports must exist on the server, with the minutes it reported and
 *   the application identity as author.
 * - rejection: the rejection project has time tracking disabled, so YouTrack
 *   refuses the worklog. There must be no false success — no "Logged" toast,
 *   no work item. The recovery path (quit protection, the next launch) is
 *   recorded as observation, not asserted, because no requirement states it.
 */

import fs from 'fs';
import path from 'path';
import { test, expect } from './harness/fixture';
import { openDesk } from './harness/ui';
import { setFields, workItems } from './harness/server';
import { Client } from './harness/clients';

async function workItemCount(verifier: Client, issueId: string): Promise<{ count: number | null; note: string }> {
  try {
    return { count: (await workItems(verifier, issueId)).length, note: 'read' };
  } catch (e) {
    return { count: null, note: (e as Error).message };
  }
}

test('B9 (success) — Stop & log posts the worklog it reports', async ({ live }) => {
  live.expected('Start focus opens the focus overlay for the Now issue. Stop & log shows "Logged N min to \'<id>\'", closes the overlay, and exactly one new work item of N minutes by the application identity exists on the server.');

  const issue = await live.fixture('B9 logged');
  await setFields(live.verifier, issue.id, { focus: 'Yes', focusRank: 1 });
  const before = await workItems(live.verifier, issue.id);
  live.observe('work items before', before.length);

  const page = await live.app.launch();
  await openDesk(page);
  await page.locator(`[data-testid="priority-desk-start-focus-${issue.id}"]`).click();
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="focus-task-id"]')).toHaveText(issue.idReadable);
  await live.app.screenshot('b9-overlay');

  await page.locator('[data-testid="focus-stop-btn"]').click();
  const toast = page.getByText(new RegExp(`Logged (\\d+) min to '${issue.idReadable}'`));
  await expect(toast).toBeVisible();
  const minutes = Number((await toast.innerText()).match(/Logged (\d+) min/)![1]);
  live.observe('toast', await toast.innerText());
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeHidden();

  await expect.poll(async () => (await workItems(live.verifier, issue.id)).length).toBe(before.length + 1);
  const after = await workItems(live.verifier, issue.id);
  const added = after.filter((w) => !before.some((b) => b.id === w.id));
  live.observe('work item added', added);
  expect(added).toHaveLength(1);
  expect(added[0].duration.minutes).toBe(minutes);
  expect(added[0].author?.login).toBe(live.preflight.appLogin);
});

test('B9 (rejection) — a refused worklog is not reported as logged; recovery is recorded', async ({ live }) => {
  live.expected('When YouTrack refuses the worklog, Stop & log shows "Failed to log worklog", no "Logged" message appears, and no work item is created on the server.');
  live.pendingDecision('What should happen to the running timer after a refused worklog (K2). The overlay, quit dialog and next-launch behavior are recorded under Observed, not asserted.');

  const issue = await live.fixture('B9 rejected', 'reject');
  await setFields(live.verifier, issue.id, { focus: 'Yes', focusRank: 1 });
  const before = await workItemCount(live.verifier, issue.id);
  live.observe('work items before', before);

  const page = await live.app.launch();
  await openDesk(page);
  await page.locator(`[data-testid="priority-desk-start-focus-${issue.id}"]`).click();
  await expect(page.locator('[data-testid="focus-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="focus-task-id"]')).toHaveText(issue.idReadable);

  await page.locator('[data-testid="focus-stop-btn"]').click();
  const failure = page.getByText(/Failed to log worklog/);
  await expect(failure).toBeVisible();
  live.observe('failure toast', await failure.innerText());
  await expect(page.getByText(/Logged \d+ min/)).toHaveCount(0);
  await live.app.screenshot('b9-rejected');

  const after = await workItemCount(live.verifier, issue.id);
  live.observe('work items after', after);
  if (before.count !== null && after.count !== null) expect(after.count, 'no work item may be created').toBe(before.count);
  else expect(after.count ?? 0, 'no work item may be visible').toBe(0);

  // Recovery, observed only.
  live.observe('overlay still open after the refusal', await page.locator('[data-testid="focus-overlay"]').isVisible());
  const checkpoint = path.join(live.app.profileDir, 'timer-state.json');
  live.observe('timer checkpoint present after the refusal', fs.existsSync(checkpoint));

  await live.app.requestQuit();
  const quitDialog = page.getByText('Timer running — quit?');
  const dialogShown = await quitDialog.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
  live.observe('quit dialog shown on quit', dialogShown);
  if (dialogShown) {
    await live.app.screenshot('b9-quit-dialog');
    await live.app.stopTrace();
    await page.getByRole('button', { name: 'Stop timer & quit' }).click();
  }
  const exitCode = await live.app.waitForExit().then((c) => c, (e: Error) => `did not exit: ${e.message}`);
  live.observe('process exit after Stop timer & quit', exitCode);
  live.observe('timer checkpoint present after quitting', fs.existsSync(checkpoint));

  if (typeof exitCode !== 'string') {
    const page2 = await live.app.launch();
    await expect(page2.locator('[data-testid="nav-priority-desk"]')).toBeVisible({ timeout: 60_000 });
    const recovery = page2.getByText(/previous session/);
    const recoveryShown = await recovery.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    live.observe('next launch: previous-session message', recoveryShown ? await recovery.innerText() : 'none within 10 s');
    live.observe('next launch: overlay open', await page2.locator('[data-testid="focus-overlay"]').isVisible());
    await live.app.screenshot('b9-next-launch');
  }
  live.observe('work items at end', await workItemCount(live.verifier, issue.id));
});

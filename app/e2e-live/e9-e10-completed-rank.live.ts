/**
 * E9 and E10 — what a completed issue's retained rank does. Checklist: § E9,
 * § E10; requirements "Completed issues and focus" (decided 2026-11-08,
 * VERM-10).
 *
 * - E9: a Done issue keeps its stored rank but does not reserve it. Giving
 *   that rank to an active issue through the UI raises no occupied-rank
 *   question and no repair state, and leaves the Done issue's stored values
 *   alone.
 * - E10: when the Done issue is reopened by another client, its retained rank
 *   now collides with the active holder. After a restart the repair state
 *   names both, nothing is changed on the server until the user chooses, and
 *   the user's choice persists.
 *
 * Completion and reopening are written by the independent verifier (standing
 * in for the web UI). E8 covers completing through Vermilian's own UI.
 */

import { test, expect } from './harness/fixture';
import { badge, openDesk, openProject, pickRank } from './harness/ui';
import { setFields } from './harness/server';

test('E9 — a Done issue does not reserve its rank: reuse raises no conflict', async ({ live }) => {
  live.expected('With a Done issue still storing Focus rank 1, choosing rank 1 for an active starred issue on the board shows no "Focus rank 1 is already taken" dialog and no repair banner.');
  live.expected('The active issue takes the Now card, and holds rank 1 on the server. The Done issue\'s stored Focus (Yes) and Focus rank (1) are unchanged.');

  const finished = await live.fixture('E9 finished');
  const active = await live.fixture('E9 active');
  await setFields(live.verifier, finished.id, { focus: 'Yes', focusRank: 1 });
  await setFields(live.verifier, finished.id, { status: live.settings.doneState });
  await setFields(live.verifier, active.id, { focus: 'Yes', focusRank: null });
  await live.server('before', [finished.id, active.id]);

  const page = await live.app.launch();
  await openProject(page, live.project.name);
  await pickRank(page, active.id, 1);

  // The conflict dialog, if the app raised one, would appear in place of the
  // rank landing. Wait for the outcome on the server, then check the screen.
  const conflict = page.locator('[data-testid="focus-rank-conflict-dialog"]');
  await expect.poll(async () => {
    if (await conflict.count()) return 'conflict dialog shown';
    return (await live.read(active.id)).focusRank;
  }, { message: 'rank 1 should land on the active issue with no conflict dialog' }).toBe(1);
  live.observe('conflict dialog shown', await conflict.count() > 0);
  await expect(conflict).toHaveCount(0);
  await expect(badge(page, active.id)).toHaveText('1');
  await live.app.screenshot('e9-board');

  await openDesk(page);
  await expect(page.locator(`[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-${active.id}"]`)).toBeVisible();
  live.observe('repair banner present', await page.locator('[data-testid="focus-rank-repair-banner"]').count() > 0);
  await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toHaveCount(0);
  await live.app.screenshot('e9-desk');

  const after = await live.server('after', [finished.id, active.id]);
  expect(after[active.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1 });
  expect(after[finished.idReadable], 'the Done issue\'s stored values must be untouched').toMatchObject({ focus: 'Yes', focusRank: 1, status: live.settings.doneState });
});

test('E10 — reopening a ranked issue whose rank is now taken shows the repair state, no winner', async ({ live }) => {
  live.expected('While the issue is Done, the desk shows the active holder in Now with no repair banner.');
  live.expected('After another client reopens it and Vermilian restarts, "Focus rank 1 is held by 2 issues" names both, the Now slot shows no single winner, and the server still holds rank 1 on both.');
  live.expected('"Keep <active> at rank 1" clears the warning; the reopened issue stays Focus Yes, unranked — on screen and on the server.');

  const reopened = await live.fixture('E10 reopened');
  const active = await live.fixture('E10 active');
  await setFields(live.verifier, reopened.id, { focus: 'Yes', focusRank: 1, whyNow: 'Live harness reason E10' });
  await setFields(live.verifier, reopened.id, { status: live.settings.doneState });
  await setFields(live.verifier, active.id, { focus: 'Yes', focusRank: 1 });
  await live.server('before', [reopened.id, active.id]);

  let page = await live.app.launch();
  await openDesk(page);
  await expect(page.locator(`[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-${active.id}"]`)).toBeVisible();
  live.observe('repair banner while Done', await page.locator('[data-testid="focus-rank-repair-banner"]').count() > 0);
  await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toHaveCount(0);
  await live.app.screenshot('e10-while-done');

  // Another client reopens it.
  await setFields(live.verifier, reopened.id, { status: live.settings.openState });
  await live.server('after-reopen', [reopened.id, active.id]);

  live.observe('first process exit', await live.app.close('E10 restart'));
  page = await live.app.launch();
  await openDesk(page);

  const repair = page.locator('[data-testid="focus-rank-repair-1"]');
  await expect(repair).toBeVisible();
  await expect(repair).toContainText('Focus rank 1 is held by 2 issues');
  await expect(page.locator(`[data-testid="focus-rank-repair-keep-${reopened.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="focus-rank-repair-keep-${active.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="priority-desk-slot-now"] [data-testid^="priority-desk-card-"]`)).toHaveCount(0);
  live.observe('E10 warning', (await repair.innerText()).trim());
  await live.app.screenshot('e10-warning');
  const noWinner = await live.server('after-restart', [reopened.id, active.id]);
  expect(noWinner[reopened.idReadable].focusRank, 'the app must not resolve the collision on its own').toBe(1);
  expect(noWinner[active.idReadable].focusRank, 'the app must not resolve the collision on its own').toBe(1);

  await page.locator(`[data-testid="focus-rank-repair-keep-${active.id}"]`).click();
  await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toHaveCount(0);
  await expect(page.locator(`[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-${active.id}"]`)).toBeVisible();
  await expect.poll(async () => (await live.read(reopened.id)).focusRank).toBeNull();
  const repaired = await live.server('after-repair', [reopened.id, active.id]);
  expect(repaired[active.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1 });
  expect(repaired[reopened.idReadable]).toMatchObject({ focus: 'Yes', focusRank: null, whyNow: 'Live harness reason E10' });
  await live.app.screenshot('e10-after-repair');
});

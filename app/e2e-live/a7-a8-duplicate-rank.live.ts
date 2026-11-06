/**
 * A7 and A8 — a duplicate rank created outside Vermilian is detected after a
 * full restart without a winner being chosen, and the user's repair produces
 * the correct persisted state. Checklist: § A7, § A8.
 *
 * The duplicate is written by the independent verifier client (another API
 * client, standing in for the web UI), never through the application.
 */

import { test, expect } from './harness/fixture';
import { badge, openDesk, openProject } from './harness/ui';
import { setFields } from './harness/server';

test('A7/A8 — external duplicate rank shows a warning after restart, no winner; UI repair persists', async ({ live }) => {
  live.expected('A7: after a full restart, Priority Desk shows "Focus rank 2 is held by 2 issues" and the Next slot reads "2 issues share Focus rank 2 — resolve above." Neither issue is shown as the Next card, and the server still holds rank 2 on both.');
  live.expected('A8: "Keep <keeper> at rank 2" clears the warning, puts the keeper on the Next card, and leaves the other issue starred and unranked — on screen and on the server.');

  const keeper = await live.fixture('A7 keeper');
  const intruder = await live.fixture('A7 intruder');
  await setFields(live.verifier, keeper.id, { focus: 'Yes', focusRank: 2 });
  await setFields(live.verifier, intruder.id, { focus: 'Yes', focusRank: null });

  // First launch: a clean desk with the keeper at Next.
  let page = await live.app.launch();
  await openDesk(page);
  await expect(page.locator(`[data-testid="priority-desk-slot-next"] [data-testid="priority-desk-card-${keeper.id}"]`)).toBeVisible();
  await live.app.screenshot('a7-before-duplicate');

  // Another client creates the duplicate.
  await setFields(live.verifier, intruder.id, { focusRank: 2 });
  const dup = await live.server('after-external-duplicate', [keeper.id, intruder.id]);
  expect(dup[keeper.idReadable].focusRank, 'verifier wrote the duplicate').toBe(2);
  expect(dup[intruder.idReadable].focusRank, 'verifier wrote the duplicate').toBe(2);

  // Full restart.
  const closed = await live.app.close('A7 restart');
  live.observe('first process exit', closed);
  page = await live.app.launch();
  await openDesk(page);

  const repair = page.locator('[data-testid="focus-rank-repair-2"]');
  await expect(repair).toBeVisible();
  await expect(repair).toContainText('Focus rank 2 is held by 2 issues');
  await expect(page.locator('[data-testid="priority-desk-duplicate-next"]')).toContainText('2 issues share Focus rank 2 — resolve above.');
  await expect(page.locator(`[data-testid="priority-desk-slot-next"] [data-testid^="priority-desk-card-"]`)).toHaveCount(0);
  live.observe('A7 warning', (await repair.innerText()).trim());
  await live.app.screenshot('a7-warning');
  const noWinner = await live.server('after-restart', [keeper.id, intruder.id]);
  expect(noWinner[keeper.idReadable].focusRank, 'the app must not resolve the duplicate on its own').toBe(2);
  expect(noWinner[intruder.idReadable].focusRank, 'the app must not resolve the duplicate on its own').toBe(2);

  // A8 — the user's repair.
  await expect(page.locator(`[data-testid="focus-rank-repair-keep-${keeper.id}"]`)).toContainText(`Keep ${keeper.idReadable} at rank 2`);
  await page.locator(`[data-testid="focus-rank-repair-keep-${keeper.id}"]`).click();
  await expect(page.locator('[data-testid="focus-rank-repair-banner"]')).toHaveCount(0);
  await expect(page.locator(`[data-testid="priority-desk-slot-next"] [data-testid="priority-desk-card-${keeper.id}"]`)).toBeVisible();
  await expect.poll(async () => (await live.read(intruder.id)).focusRank).toBeNull();
  const repaired = await live.server('after-repair', [keeper.id, intruder.id]);
  expect(repaired[keeper.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 2 });
  expect(repaired[intruder.idReadable]).toMatchObject({ focus: 'Yes', focusRank: null });

  await openProject(page, live.project.name);
  await expect(badge(page, intruder.id)).toHaveText('–');
  await expect(badge(page, keeper.id)).toHaveText('2');
  await live.app.screenshot('a8-board-after-repair');
});

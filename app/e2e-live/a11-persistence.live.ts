/**
 * A11 — everything survives a restart. Checklist: § A11.
 *
 * Focus, rank and Why now are set through the UI only, confirmed on the
 * server by the verifier, and then the application process is shut down
 * completely (its exit is awaited) and relaunched on the same isolated
 * profile.
 */

import { test, expect } from './harness/fixture';
import { badge, openDesk, openProject, pickRank, star } from './harness/ui';

const REASON = 'Live harness reason A11';

test('A11 — UI edits persist to YouTrack and survive a full shutdown and relaunch on the same profile', async ({ live }) => {
  live.expected('After starring, ranking 1 and entering Why now in the UI, the server shows Focus=Yes, Focus rank=1 and the same Why now; after a complete process exit and relaunch, the desk\'s Now card shows the issue and its reason, and the server values are unchanged.');

  const issue = await live.fixture('A11 persistent');
  await live.server('before', [issue.id]);

  const page = await live.app.launch();
  await openProject(page, live.project.name);
  await star(page, issue.id).click();
  await expect(badge(page, issue.id)).toHaveText('–');
  await pickRank(page, issue.id, 1);
  await expect(badge(page, issue.id)).toHaveText('1');

  await page.locator(`[data-task-id="${issue.id}"] [data-testid="issue-id"]`).first().click();
  const panel = page.locator('[data-testid="task-detail-panel"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-field="whyNow"] button').click();
  await panel.locator('[data-field="whyNow"] input').fill(REASON);
  await panel.locator('[data-field="whyNow"] input').press('Enter');
  await expect(panel.locator('[data-field="whyNow"] button')).toHaveText(REASON);
  await page.keyboard.press('Escape');

  await expect.poll(async () => (await live.read(issue.id)).whyNow).toBe(REASON);
  const saved = await live.server('after-ui-edits', [issue.id]);
  expect(saved[issue.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1, whyNow: REASON });

  const exit = await live.app.close('A11 full shutdown');
  live.observe('process exit', exit);
  expect(exit.forced, 'the app should exit on its own when asked').toBe(false);

  const page2 = await live.app.launch();
  await openDesk(page2);
  const card = page2.locator(`[data-testid="priority-desk-slot-now"] [data-testid="priority-desk-card-${issue.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(REASON);
  live.observe('Now card after relaunch', (await card.innerText()).trim());
  await live.app.screenshot('a11-desk-after-relaunch');

  const after = await live.server('after-relaunch', [issue.id]);
  expect(after[issue.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1, whyNow: REASON });
});

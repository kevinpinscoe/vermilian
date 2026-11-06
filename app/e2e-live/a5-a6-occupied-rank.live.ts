/**
 * A5 and A6 — an occupied rank asks first, and moving a rank is the user's
 * decision. Checklist: docs/priority-desk-acceptance.md § A5, § A6.
 *
 * Start state (set by the verifier, not the app): HOLDER is starred at rank 1,
 * CLAIMANT is starred with no rank. Every interaction under test is a UI click.
 */

import { test, expect } from './harness/fixture';
import { badge, openProject, pickRank } from './harness/ui';
import { setFields } from './harness/server';

test('A5/A6 — occupied-rank dialog names the holder; Keep changes nothing; Move transfers; transfer back', async ({ live }) => {
  live.expected('A5: the dialog says "Focus rank 1 is already taken" and names the holder; after Keep, holder is still 1 and claimant still unranked, on screen and on the server.');
  live.expected('A6: Move rank here gives the claimant rank 1 and leaves the old holder starred and unranked; moving it back restores the original state. Both stars are preserved throughout.');

  const holder = await live.fixture('A5 holder');
  const claimant = await live.fixture('A5 claimant');
  await setFields(live.verifier, holder.id, { focus: 'Yes', focusRank: 1 });
  await setFields(live.verifier, claimant.id, { focus: 'Yes', focusRank: null });
  await live.server('before', [holder.id, claimant.id]);

  const page = await live.app.launch();
  await openProject(page, live.project.name);
  await expect(badge(page, holder.id)).toHaveText('1');
  await expect(badge(page, claimant.id)).toHaveText('–');

  // A5 — the dialog, then Keep.
  await pickRank(page, claimant.id, 1);
  const dialog = page.locator('[data-testid="focus-rank-conflict-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Focus rank 1 is already taken');
  await expect(dialog).toContainText(holder.idReadable);
  await expect(page.locator('[data-testid="focus-rank-conflict-keep"]')).toContainText(holder.idReadable);
  live.observe('A5 dialog text', (await dialog.innerText()).trim());
  await live.app.screenshot('a5-dialog');
  await page.locator('[data-testid="focus-rank-conflict-keep"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(badge(page, holder.id)).toHaveText('1');
  await expect(badge(page, claimant.id)).toHaveText('–');
  const afterKeep = await live.server('after-keep', [holder.id, claimant.id]);
  expect(afterKeep[holder.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1 });
  expect(afterKeep[claimant.idReadable]).toMatchObject({ focus: 'Yes', focusRank: null });

  // A6 — Move rank here.
  await pickRank(page, claimant.id, 1);
  await expect(dialog).toBeVisible();
  await page.locator('[data-testid="focus-rank-conflict-move"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(badge(page, claimant.id)).toHaveText('1');
  await expect(badge(page, holder.id)).toHaveText('–');
  await expect.poll(async () => (await live.read(claimant.id)).focusRank).toBe(1);
  const afterMove = await live.server('after-move', [holder.id, claimant.id]);
  expect(afterMove[claimant.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1 });
  expect(afterMove[holder.idReadable]).toMatchObject({ focus: 'Yes', focusRank: null });

  // A6 — and back.
  await pickRank(page, holder.id, 1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(claimant.idReadable);
  await page.locator('[data-testid="focus-rank-conflict-move"]').click();
  await expect(badge(page, holder.id)).toHaveText('1');
  await expect(badge(page, claimant.id)).toHaveText('–');
  await expect.poll(async () => (await live.read(holder.id)).focusRank).toBe(1);
  const end = await live.server('after-move-back', [holder.id, claimant.id]);
  expect(end[holder.idReadable]).toMatchObject({ focus: 'Yes', focusRank: 1 });
  expect(end[claimant.idReadable]).toMatchObject({ focus: 'Yes', focusRank: null });
});

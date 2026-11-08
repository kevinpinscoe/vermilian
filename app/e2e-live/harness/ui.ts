/**
 * UI steps shared by the live scenarios. Every locator here is a test id the
 * deterministic suite (e2e/) already exercises, so a locator failure in a live
 * run points at the live environment rather than at an untested selector.
 * Waits are on observable conditions only — no fixed sleeps.
 */

import { expect, Page } from '@playwright/test';

export async function waitForRail(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="nav-project"]').first()).toBeVisible({ timeout: 60_000 });
}

export async function openProject(page: Page, projectName: string): Promise<void> {
  await waitForRail(page);
  await page.locator('[data-testid="nav-project"]', { hasText: projectName }).first().click();
  await expect(page.locator('[data-testid="main-table"]')).toBeVisible({ timeout: 30_000 });
}

export const star = (page: Page, issueId: string) => page.locator(`[data-testid="focus-star-${issueId}"]`).first();
export const badge = (page: Page, issueId: string) => page.locator(`[data-testid="focus-rank-badge-${issueId}"]`).first();

/** Opens the rank menu on an issue's badge and picks a rank. */
export async function pickRank(page: Page, issueId: string, rank: 1 | 2 | 3): Promise<void> {
  await badge(page, issueId).click();
  await expect(page.locator(`[data-testid="focus-rank-menu-${issueId}"]`)).toBeVisible();
  await page.locator(`[data-testid="focus-rank-option-${issueId}-${rank}"]`).click();
}

export async function openDesk(page: Page): Promise<void> {
  await page.locator('[data-testid="nav-priority-desk"]').click();
  await expect(page.locator('[data-testid="priority-desk"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="priority-desk-mode-now"]')).toBeVisible();
}

export async function openDailyReview(page: Page): Promise<void> {
  await page.locator('[data-testid="daily-review-btn"]').click();
  await expect(page.locator('[data-testid="daily-review-body"]')).toBeVisible({ timeout: 30_000 });
}

/** Text of a locator if present, else null — for observations, never assertions. */
export async function textOrNull(page: Page, selector: string): Promise<string | null> {
  const loc = page.locator(selector).first();
  return (await loc.count()) ? (await loc.innerText()).trim() : null;
}

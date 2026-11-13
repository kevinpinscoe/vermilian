/**
 * Per-reference credentials (VERM-45) through the real IPC channels: status,
 * configuration and a resolution check that never returns the value. Nothing
 * in the app resolves workspace credentials yet (VERM-46/47 switch callers
 * over), so the spec drives the API directly.
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers/launch';

// Fictional values only.
const VALUE = 'e2e-fictional-credential-value';

test.describe('Per-reference credentials', () => {
  let app: ElectronApplication | undefined;
  let dir: string;

  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'verm45-e2e-'));
  });
  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  test('configure, check without exposing the value, fail closed, legacy untouched', async () => {
    app = await launchApp();
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
    const keyFile = path.join(dir, 'key');
    writeFileSync(keyFile, `${VALUE}\n`);

    const before = await page.evaluate(() => window.vermilian.getConfig());

    // The three legacy references are always listed, read from legacy fields.
    const initial = await page.evaluate(() => window.vermilian.listCredentialRefs());
    expect(initial.filter((s) => s.legacy).map((s) => s.credentialRef)).toEqual(['anthropic-1', 'jira-1', 'youtrack-1']);

    // A custom reference gets its own file source.
    expect(
      await page.evaluate((f) => window.vermilian.setCredentialRefSources('anthropic-2', { command: '', file: f }), keyFile),
    ).toEqual({ ok: true });
    const listed = await page.evaluate(() => window.vermilian.listCredentialRefs());
    expect(listed.find((s) => s.credentialRef === 'anthropic-2')).toMatchObject({ legacy: false, selected: 'file' });

    // The check resolves in main and returns only the source.
    const ok = await page.evaluate(() => window.vermilian.checkWorkspaceCredential('workspace-a', 'anthropic-2'));
    expect(ok).toEqual({ ok: true, credentialRef: 'anthropic-2', source: 'file' });
    expect(JSON.stringify(ok)).not.toContain(VALUE);

    // A broken configured file stops; nothing else is tried.
    await page.evaluate((f) => window.vermilian.setCredentialRefSources('anthropic-2', { command: '', file: f }), path.join(dir, 'missing'));
    const bad = await page.evaluate(() => window.vermilian.checkWorkspaceCredential('workspace-a', 'anthropic-2'));
    expect(bad).toMatchObject({ ok: false, workspaceId: 'workspace-a', credentialRef: 'anthropic-2', source: 'file', reason: 'file-unreadable' });
    expect(JSON.stringify(bad)).not.toContain(dir);

    // No reference selected: unavailable.
    expect(await page.evaluate(() => window.vermilian.checkWorkspaceCredential('workspace-a', null))).toMatchObject({
      ok: false,
      reason: 'not-selected',
    });

    // Legacy references cannot be reconfigured here, and saveConfig cannot
    // write the per-reference map.
    expect(
      await page.evaluate(() => window.vermilian.setCredentialRefSources('anthropic-1', { command: 'x', file: '' })),
    ).toEqual({ ok: false, reason: 'legacy-reference' });
    await page.evaluate(() =>
      window.vermilian.saveConfig({ credentialSources: { 'anthropic-9': { command: 'x', file: '' } } }),
    );
    const after = await page.evaluate(() => window.vermilian.getConfig());
    expect(Object.keys(after.credentialSources)).toEqual(['anthropic-2']);
    for (const k of ['youtrackTokenCommand', 'youtrackTokenFile', 'claudeKeyCommand', 'claudeKeyFile', 'jiraTokenCommand', 'jiraTokenFile'] as const) {
      expect(after[k]).toBe(before[k]);
    }

    // Clearing both sources removes the entry.
    await page.evaluate(() => window.vermilian.setCredentialRefSources('anthropic-2', { command: '', file: '' }));
    expect((await page.evaluate(() => window.vermilian.getConfig())).credentialSources).toEqual({});
  });
});

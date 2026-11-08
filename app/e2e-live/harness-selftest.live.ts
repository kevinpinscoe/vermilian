/**
 * HARNESS — self-test of the launcher and evidence capture. Needs no server,
 * no account and no fixtures, so it runs even when the preflight blocks every
 * checklist scenario.
 *
 * It launches the build under test on an empty isolated profile (first-run
 * Settings, no YouTrack URL, no token), with fake-service mode removed, and
 * checks that the run produced a trace, a screenshot and the app log.
 */

import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import { LiveApp, seedProfile, tempProfileDir } from './harness/app';
import { loadSettings } from './harness/settings';

base('HARNESS — real binary launches on an isolated profile with fake services off, and evidence is captured', async ({}, testInfo) => {
  testInfo.annotations.push({ type: 'expected', description: 'The build under test starts with no VERMILIAN_E2E* variable, shows first-run Settings on an empty profile, and the run leaves a trace, a screenshot and an app log.' });
  const settings = loadSettings();
  const profileDir = tempProfileDir();
  seedProfile(profileDir, { server: null, projectIds: [] });
  const live = new LiveApp(settings, testInfo, profileDir);
  try {
    const page = await live.launch();
    // No YouTrack URL in the profile → the app must route to Settings, which
    // a fake-service launch (it seeds a URL) would never do.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Connect your YouTrack instance to get started')).toBeVisible();
    await live.screenshot('first-run-settings');
    await live.close('self-test complete');
  } finally {
    await live.finish();
  }
  for (const name of ['trace-launch-1.zip', 'first-run-settings.png', 'app-log.txt']) {
    expect(fs.existsSync(testInfo.outputPath(name)), `${name} should exist`).toBe(true);
  }
});

import { defineConfig } from '@playwright/test';
import path from 'path';
import { loadSettings } from './e2e-live/harness/settings';

// Live acceptance harness — real YouTrack, real application identity, never
// the fake services. Kept apart from playwright.config.ts (the deterministic
// fake-YouTrack suite in e2e/) so neither can pick up the other's tests.
//
// Serial by design: scenarios share server-side fixtures, so one worker, no
// parallelism, and no retries — a retry would hide the initial failure. Each
// run writes to its own timestamped directory and never overwrites another.
const settings = loadSettings(); // also fixes VERMILIAN_LIVE_RUN_DIR for the workers

export default defineConfig({
  testDir: './e2e-live',
  testMatch: '**/*.live.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: path.join(settings.evidenceDir, 'test-output'),
  preserveOutput: 'always',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(settings.evidenceDir, 'html') }],
    ['./e2e-live/harness/reporter.ts'],
  ],
  // Page-fixture capture options do not reach windows of a manually launched
  // Electron app; e2e-live/harness/app.ts configures tracing, screenshots and
  // log capture on the ElectronApplication itself.
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // One Electron profile root per run, removed when the run ends (VERM-54).
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});

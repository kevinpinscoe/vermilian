import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch';

test.describe('App launch', () => {
  test('renders main window', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();

    await expect(window).toHaveTitle(/Vermilian/);
    await app.close();
  });

  test('window is visible and not blank', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();

    // Wait for React to mount
    await window.waitForSelector('#root', { state: 'attached' });
    const root = await window.$('#root');
    expect(root).not.toBeNull();

    await app.close();
  });
});

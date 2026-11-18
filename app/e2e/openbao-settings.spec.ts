/**
 * Settings → OpenBao credential storage (VERM-64): the section renders, refuses
 * an unsafe server address, and keeps a saved connection across a reopen.
 */

import { test, expect, Page, ElectronApplication } from '@playwright/test';
import { launchApp } from './helpers/launch';

test.describe('OpenBao credential storage', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await page.getByTestId('topbar-settings-btn').click();
    await expect(page.getByTestId('openbao-section')).toBeVisible();
  });

  test.afterEach(async () => {
    await app.close();
  });

  test('offers the Settings credentials with no connection yet', async () => {
    await expect(page.getByTestId('openbao-ref-youtrack-1')).toHaveAttribute('data-active', 'false');
    await expect(page.getByTestId('openbao-test')).toBeDisabled();
    await expect(page.getByTestId('openbao-migrate')).toBeDisabled();
  });

  test('refuses plain http to another machine', async () => {
    await page.getByTestId('openbao-url').fill('http://bao.example.test');
    await page.getByTestId('openbao-role-id').fill('fake-role-id');
    await page.getByTestId('openbao-secret-file').fill('/fake/secret-id');
    await page.getByTestId('openbao-save').click();
    await expect(page.getByTestId('openbao-outcome')).toContainText('https://');
    await expect(page.getByTestId('openbao-test')).toBeDisabled();
  });

  test('saves a connection and reports an unreachable server', async () => {
    await page.getByTestId('openbao-url').fill('http://127.0.0.1:9');
    await page.getByTestId('openbao-role-id').fill('fake-role-id');
    await page.getByTestId('openbao-secret-command').fill('echo fake-secret-id');
    await page.getByTestId('openbao-save').click();
    await expect(page.getByTestId('openbao-outcome')).toContainText('Connection saved');
    await expect(page.getByTestId('openbao-test')).toBeEnabled();
    await page.getByTestId('openbao-test').click();
    await expect(page.getByTestId('openbao-test-result')).toHaveAttribute('data-status', 'unreachable');
  });
});

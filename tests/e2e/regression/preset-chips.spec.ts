import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Regression: provider preset chips (#68).
 *
 * Open the onboarding wizard, click the "DeepSeek" preset chip, and verify:
 *   - the type <select> changes to "openai-compat"
 *   - the baseURL <input> is populated with https://api.deepseek.com/v1
 *   - the name <input> is populated with "DeepSeek" (because the field was empty)
 *
 * No API keys required.
 */

let app: ElectronApplication;
let win: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-presets-'));
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1200);
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('preset chip "DeepSeek" populates type, baseURL, and name', async () => {
  // Onboarding step 1 — click "Get started"
  await win.locator('button', { hasText: /Get started/i }).click();
  await win.waitForTimeout(300);

  // Click DeepSeek preset chip
  await win.locator('button', { hasText: /^DeepSeek$/ }).click();
  await win.waitForTimeout(150);

  // Verify type <select> changes to openai-compat. The form's select is the
  // first <select> inside the form (the top-nav language switcher is the very
  // first <select> on the page, so we scope by the form container).
  const typeSelect = win.locator('form select').first();
  await expect(typeSelect).toHaveValue('openai-compat');

  // Name input populated with "DeepSeek"
  const nameInput = win.locator('form input[type="text"]').first();
  await expect(nameInput).toHaveValue('DeepSeek');

  // baseURL input — when type=openai-compat, baseURL is the second visible text input
  const baseUrlInput = win.locator('form input[type="text"]').nth(1);
  await expect(baseUrlInput).toHaveValue('https://api.deepseek.com/v1');
});

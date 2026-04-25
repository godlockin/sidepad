import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Regression: Settings → Tools tab (#76).
 *
 * Type a fake Brave key, click Save, then re-render the tab and assert the
 * "Configured" badge is shown and the input is masked (placeholder shows
 * bullets). Repeat for Tavily.
 *
 * No external network calls — keys are stored locally only.
 */

let app: ElectronApplication;
let win: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-toolskeys-'));
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

async function gotoToolsTab() {
  // Skip onboarding if it's showing
  const skip = win.locator('button', { hasText: /Skip for now/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await win.waitForTimeout(300);
  }
  // Open Settings via top nav (only available off-onboarding)
  const settingsBtn = win.locator('header').locator('button', { hasText: /^Settings$/i }).first();
  if (await settingsBtn.isVisible().catch(() => false)) {
    await settingsBtn.click();
    await win.waitForTimeout(200);
  }
  await win.locator('aside').locator('button', { hasText: /^Tools$/i }).first().click();
  await win.waitForTimeout(300);
}

test('save Brave key → "configured" badge appears and input shows masked placeholder', async () => {
  await gotoToolsTab();

  const braveInput = win.locator('input#tools-brave_api_key');
  await expect(braveInput).toBeVisible({ timeout: 5000 });
  await braveInput.fill('fake-brave-key-123');

  // The Save button is in the same row as the input.
  await win.locator('button', { hasText: /^Save$/ }).first().click();
  await win.waitForTimeout(800);

  // After save the draft is cleared and the input value is empty,
  // but the placeholder should reflect the masked state.
  await expect(braveInput).toHaveAttribute('placeholder', /•+/);
  await expect(win.locator('text=/configured/i').first()).toBeVisible();
});

test('save Tavily key → "configured" badge appears', async () => {
  await gotoToolsTab();

  const tavilyInput = win.locator('input#tools-tavily_api_key');
  await expect(tavilyInput).toBeVisible({ timeout: 5000 });
  await tavilyInput.fill('fake-tavily-key-xyz');

  // Click the second Save button (Tavily row)
  const saves = win.locator('button', { hasText: /^Save$/ });
  const count = await saves.count();
  await saves.nth(count - 1).click();
  await win.waitForTimeout(800);

  await expect(tavilyInput).toHaveAttribute('placeholder', /•+/);
  // Two configured badges should now exist
  const badges = win.locator('text=/configured/i');
  const n = await badges.count();
  expect(n).toBeGreaterThanOrEqual(2);
});

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Regression: onboarding wizard skip + reload behavior.
 *
 * Documents the actual current behavior:
 *   - On a fresh launch with no providers, the welcome step is shown.
 *   - Clicking "Skip for now" navigates to Settings.
 *   - Reloading (closing + relaunching) the app re-shows the wizard, because
 *     `App.tsx` gates onboarding on `providers.length === 0` after settings load.
 *
 * This regression captures that behavior so we notice if the gating logic
 * changes (e.g. switching to a "skipped" flag in app_settings would change
 * test 2's expectation).
 *
 * No API keys required.
 */

let app: ElectronApplication;
let win: Page;
let userData: string;

async function launch() {
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1200);
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-onboard-'));
  await launch();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('fresh userData shows the welcome wizard', async () => {
  await expect(win.locator('h1')).toContainText(/Welcome to sidepad/i, { timeout: 5000 });
});

test('"Skip for now" lands on Settings page', async () => {
  await win.locator('button', { hasText: /Skip for now/i }).first().click();
  await win.waitForTimeout(400);
  // Settings sidebar should be visible
  await expect(
    win.locator('aside').locator('button', { hasText: /voices|声音/i }).first(),
  ).toBeVisible({ timeout: 5000 });
});

test('reloading app with no providers re-shows the wizard (current behavior)', async () => {
  await app.close();
  await launch();
  // With providers.length === 0, App.tsx forces page → onboarding on load.
  await expect(win.locator('h1')).toContainText(/Welcome to sidepad/i, { timeout: 5000 });
});

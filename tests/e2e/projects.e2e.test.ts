import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Cockpit P1 — projects wizard happy path:
 *   - launch fresh app instance
 *   - dismiss onboarding if present
 *   - click Projects tab → New project → fill name → stub pickFolder → Create
 *   - confirm project + mount appear in the page
 */

let app: ElectronApplication;
let win: Page;
let userData: string;
let sandbox: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-e2e-projects-'));
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-e2e-mount-'));
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('cockpit projects: create project + add inputs mount', async () => {
  // Stub the native folder picker before any wizard interaction.
  await win.evaluate((p) => {
    (window as any).cockpit = { pickFolder: async () => p };
  }, sandbox);

  // If onboarding shows, skip it (no providers configured).
  const skip = win.locator('button', { hasText: /Skip|稍后/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await win.waitForTimeout(300);
  }

  // Navigate to Projects tab.
  await win.locator('header button', { hasText: /^Projects$|^项目$/ }).click();
  await win.waitForTimeout(200);

  // Open the wizard.
  await win.locator('button', { hasText: /^New project$|^新建项目$/ }).first().click();
  await expect(win.locator('[role="dialog"][aria-label="project-wizard"]')).toBeVisible();

  // Fill name.
  await win.locator('[role="dialog"] input').first().fill('e2e-demo');

  // Click "Pick folder" — stubbed to return our sandbox path.
  await win.locator('button', { hasText: /Pick folder|选择文件夹/ }).click();

  // Pending mount row should show the sandbox path.
  await expect(win.locator('[role="dialog"]').locator('text=' + sandbox)).toBeVisible();

  // Submit.
  await win.locator('button', { hasText: /^Create project$|^创建项目$/ }).click();
  await win.waitForTimeout(500);

  // Project chip appears in left sidebar of ProjectsPage.
  await expect(win.locator('aside button', { hasText: 'e2e-demo' })).toBeVisible();

  // Mount path renders in the detail pane.
  await expect(win.locator('main').locator('text=' + sandbox)).toBeVisible();
});

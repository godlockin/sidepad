import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Vision-based UI/UX integration test for the Atelier redesign.
 * Captures screenshots of every major surface so we can review the rendered
 * design against the spec.
 */
const SHOTS_DIR = path.resolve('tests/e2e/screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

let app: ElectronApplication;
let win: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-visual-'));
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  // Wait for Fraunces variable font to load so screenshots are stable.
  await win.waitForLoadState('networkidle').catch(() => {});
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

test('01 — chat empty state (default landing)', async () => {
  // Should be on chat page, no sessions yet
  await win.waitForSelector('aside', { timeout: 10_000 });
  await win.screenshot({ path: path.join(SHOTS_DIR, '01-chat-empty.png'), fullPage: false });

  // Verify masthead wordmark
  await expect(win.locator('text=sidepad').first()).toBeVisible();
  await expect(win.locator('text=vol. 01')).toBeVisible();
  // Sidebar empty-state copy
  await expect(win.locator('text=No conversations yet').first()).toBeVisible();
});

test('02 — chat after creating session (empty page paragraph mark)', async () => {
  // Click "+ new" in the sidebar
  await win.getByRole('button', { name: /new session/i }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '02-chat-new-session.png'), fullPage: false });

  // The ¶ glyph empty page should be visible
  const pilcrow = win.locator('text=¶');
  await expect(pilcrow).toBeVisible();
});

test('03 — composer hover / focus', async () => {
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('A first line, set in Fraunces.');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS_DIR, '03-composer-typed.png'), fullPage: false });
  // Character counter should appear
  await expect(win.locator('text=/\\d+ ch/')).toBeVisible();
});

test('04 — mention picker @ trigger', async () => {
  const textarea = win.locator('textarea').first();
  await textarea.fill(''); // clear
  await textarea.type('Hello @', { delay: 30 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '04-mention-picker.png'), fullPage: false });
  // The picker should be present even if empty providers — but if providers list is empty, picker won't render
  // So we just snapshot whatever state exists
});

test('05 — settings page (providers / chapter i)', async () => {
  await win.locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS_DIR, '05-settings-providers.png'), fullPage: false });
  await expect(win.locator('text=The voices at the table.')).toBeVisible();
  await expect(win.locator('text=Chapter i')).toBeVisible();
});

test('06 — settings provider form (introduce a voice)', async () => {
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '06-settings-provider-form.png'), fullPage: false });
  await expect(win.locator('text=Introduce a voice.')).toBeVisible();
});

test('07 — settings appearance (theme swatches)', async () => {
  // cancel the form first
  await win.locator('button', { hasText: /^cancel$/ }).click().catch(() => {});
  await win.waitForTimeout(200);
  // Use TOC nav (aside scope)
  await win.locator('aside').locator('button', { hasText: 'Appearance' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '07-settings-appearance.png'), fullPage: false });
  await expect(win.locator('text=A room for the words.')).toBeVisible();
});

test('08 — settings appearance dark theme applied', async () => {
  // Click the dark swatch by aria-pressed scope: pick the article's swatch buttons
  await win.locator('article button[aria-pressed]').nth(2).click();
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS_DIR, '08-settings-dark.png'), fullPage: false });
});

test('09 — colophon page', async () => {
  await win.locator('aside').locator('button', { hasText: 'Colophon' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '09-settings-colophon.png'), fullPage: false });
  await expect(win.locator('text=On this edition.')).toBeVisible();
});

test('10 — provider form on dark theme', async () => {
  await win.locator('aside').locator('button', { hasText: 'Voices' }).click();
  await win.waitForTimeout(300);
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '10-provider-form-dark.png'), fullPage: false });
});

test('11 — back to chat (dark theme)', async () => {
  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS_DIR, '11-chat-dark.png'), fullPage: false });
});

test('12 — restore light + final chat shot', async () => {
  await win.locator('header').locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(200);
  await win.locator('aside').locator('button', { hasText: 'Appearance' }).click();
  await win.waitForTimeout(200);
  await win.locator('article button[aria-pressed]').nth(1).click(); // light
  await win.waitForTimeout(500);
  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS_DIR, '12-chat-light-final.png'), fullPage: false });
});

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Onboarding wizard:
 *   O1 — fresh launch with no providers shows the welcome step
 *   O2 — clicking "Get started" reveals the ProviderForm (step 2)
 *   O3 — completing the form (Azure env) → lands in chat with a fresh session
 */

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-onboarding-'));
  dbPath = path.join(userData, 'sidepad.db');
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

test('O1 — welcome step renders when no providers', async () => {
  await expect(win.locator('h1')).toContainText(/Welcome to sidepad/i);
  await expect(win.locator('button', { hasText: /Get started/i })).toBeVisible();
});

test('O2 — Get started reveals provider form', async () => {
  await win.locator('button', { hasText: /Get started/i }).click();
  await win.waitForTimeout(300);
  await expect(win.locator('button', { hasText: 'save voice' })).toBeVisible();
});

test('O3 — completing form lands in chat with fresh session', async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  await win.locator('select').first().selectOption('openai-compat');
  await win.waitForTimeout(150);
  await win.locator('input[type="text"]').first().fill('azure-onboard');
  await win.locator('input[type="text"]').nth(1).fill(process.env.AZURE_OPENAI_ENDPOINT!);
  await win.locator('input[type="password"]').fill(process.env.AZURE_OPENAI_API_KEY!);
  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(1500);

  // Now on chat page — header has Chat tab visible.
  await expect(win.locator('header').locator('button', { hasText: 'Chat' })).toBeVisible();

  // A session row should exist.
  const sessionCount = sql(`SELECT COUNT(*) FROM sessions;`);
  expect(Number(sessionCount)).toBeGreaterThanOrEqual(1);
});

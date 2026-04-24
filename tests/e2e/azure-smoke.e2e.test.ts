import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Azure-only smoke: validate OpenAICompatProvider's Azure branch end-to-end via UI.
 *
 * Required env:
 *   AZURE_OPENAI_ENDPOINT  e.g. https://ikea-gpt-4.openai.azure.com/
 *   AZURE_OPENAI_API_KEY
 *   AZURE_OPENAI_DEPLOYMENT  e.g. gpt-4
 *   AZURE_OPENAI_API_VERSION (optional, default 2025-04-01-preview)
 */

const SHOTS = path.resolve('tests/e2e/screenshots/azure');
fs.mkdirSync(SHOTS, { recursive: true });

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

test.beforeAll(async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-azure-'));
  dbPath = path.join(userData, 'sidepad.db');
  console.log('[azure-smoke] beforeAll, userData=', userData);
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SIDEPAD_USER_DATA: userData,
    },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  win.on('console', (m) => console.log('[renderer]', m.type(), m.text()));
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  app.process().stderr?.on('data', (d) => process.stdout.write('[main-stderr] ' + d.toString()));
  app.process().stdout?.on('data', (d) => process.stdout.write('[main-stdout] ' + d.toString()));
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('Z1 — configure @azure (openai-compat) provider via UI', async () => {
  await win.locator('header').locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(300);
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(200);
  await win.locator('select').first().selectOption('openai-compat');
  await win.waitForTimeout(150);
  await win.locator('input[type="text"]').first().fill('azure');
  await win.locator('input[type="text"]').nth(1).fill(process.env.AZURE_OPENAI_ENDPOINT!);
  await win.locator('input[type="password"]').fill(process.env.AZURE_OPENAI_API_KEY!);
  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(1000);

  // Set deployment as defaultModel
  sql(
    `UPDATE provider_configs SET params_json='${JSON.stringify({ defaultModel: process.env.AZURE_OPENAI_DEPLOYMENT })}' WHERE id='azure';`,
  );

  await win.screenshot({ path: path.join(SHOTS, 'Z1-azure-saved.png') });
  await expect(win.locator('text=@azure').first()).toBeVisible({ timeout: 10_000 });
});

test('Z2 — send single @azure message and observe streaming', async () => {
  test.setTimeout(180_000);

  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(300);
  await win.locator('aside').locator('button', { hasText: '+ new' }).click();
  await win.waitForTimeout(500);
  const sessionId = sql(`SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1;`);
  console.log('Z2 session:', sessionId);

  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('@azure Reply with exactly: hello world');
  await win.waitForTimeout(150);
  await win.locator('button', { hasText: /^send/i }).click();

  // Wait for streaming start, then for it to clear
  await win
    .waitForFunction(
      () => document.body.innerText.toLowerCase().includes('composing reply'),
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await win.waitForFunction(
    () => !document.body.innerText.toLowerCase().includes('composing reply'),
    null,
    { timeout: 150_000 },
  );
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'Z2-completed.png') });

  // Verify assistant message persisted with non-empty content and no error status
  const rows = sql(
    `SELECT status, length(content) FROM messages WHERE session_id='${sessionId}' AND role='assistant';`,
  );
  console.log('Z2 assistant rows:', rows);
  expect(rows.length).toBeGreaterThan(0);

  const lines = rows.split('\n').filter(Boolean);
  expect(lines.length).toBeGreaterThanOrEqual(1);
  for (const line of lines) {
    const [status, lenStr] = line.split('|');
    expect(status).not.toBe('error');
    expect(Number(lenStr)).toBeGreaterThan(0);
  }
});

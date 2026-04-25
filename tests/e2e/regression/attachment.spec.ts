import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Regression: file attachment pipeline (#72).
 *
 * Drops `tests/fixtures/sample.txt` onto the chat input via the hidden
 * <input type="file"> (drag-drop API can't carry filesystem files in
 * Playwright, so we use the file picker instead — same uploadFiles path).
 *
 * Asserts:
 *   - chip appears with the filename
 *   - status transitions to "ready"
 *   - send button enables
 *   - on send (without an actual LLM), the user message row in DB contains
 *     `<attachment filename="sample.txt"`.
 *
 * Skips the post-send LLM round-trip — we only verify the local pipeline.
 */

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-attach-'));
  dbPath = path.join(userData, 'sidepad.db');
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

test('attachment chip → ready → message composition includes <attachment>', async () => {
  // Skip onboarding: insert a stub provider so wizard doesn't fire on this run
  // would require app restart; simpler: navigate via "Skip for now" then create session.
  // The onboarding step 1 has "Skip for now" which lands on Settings. From there we
  // can't easily create a session without providers. Instead, click "Get started"
  // → step 2 → "Skip for now" still lands on Settings. So we'll just close + seed +
  // relaunch like the export test does.
  await app.close();

  // Seed a provider + session
  const now = Math.floor(Date.now() / 1000);
  sql(
    `INSERT INTO provider_configs(id, type, name, base_url, model_list_json, params_json, enabled) ` +
      `VALUES('p1','ollama','p1','http://localhost:11434','[]','{}',1);`,
  );
  sql(
    `INSERT INTO sessions(id, title, created_at, updated_at, system_prompt, visibility_mode, group_mode, default_agent_id, participants) ` +
      `VALUES('s1','Attach Test',${now},${now},NULL,'independent','parallel','p1','[{"agentId":"p1","personaId":"default"}]');`,
  );

  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1200);

  // Open the seeded session
  await win.locator('aside').locator('text=Attach Test').first().click({ timeout: 10_000 });
  await win.waitForTimeout(400);

  // Upload via hidden file input
  const sample = path.resolve('tests/fixtures/sample.txt');
  await win.locator('input[type="file"]').setInputFiles(sample);

  // Chip appears
  await expect(win.locator('text=sample.txt').first()).toBeVisible({ timeout: 5000 });

  // Wait for the parse pipeline to finish in the DB (subscription -> UI may
  // race with boot). Polling the DB is the most robust signal.
  let parseReady = false;
  for (let i = 0; i < 40; i++) {
    const status = sql(
      `SELECT parse_status FROM attachments WHERE session_id='s1' ORDER BY created_at DESC LIMIT 1;`,
    );
    if (status === 'ready') {
      parseReady = true;
      break;
    }
    await win.waitForTimeout(250);
  }
  expect(parseReady).toBe(true);

  // Type a message and verify send is enabled
  await win.locator('textarea').first().fill('please summarize');
  const sendBtn = win.locator('button', { hasText: /^send$/i }).first();
  await expect(sendBtn).toBeEnabled();

  // Click send. It will try to call the (fake) provider — that fails, but the
  // user message row is committed before the call.
  await sendBtn.click();

  // Wait briefly for the user message insert.
  await win.waitForTimeout(1500);

  const userContent = sql(
    `SELECT content FROM messages WHERE session_id='s1' AND role='user' ORDER BY created_at DESC LIMIT 1;`,
  );
  expect(userContent).toContain('<attachment filename="sample.txt"');
});

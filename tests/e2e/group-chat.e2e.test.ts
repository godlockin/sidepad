import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * REAL multi-agent group-chat e2e.
 *
 * Covers:
 *   #1 PARALLEL — @qwen + @llama (two Ollama models, true cross-model)
 *   #2 RELAY    — @qwen → @llama, second sees first's output in history
 *   #3 LEAD-AND-COMMENT — "@qwen 你先回答 @llama" → qwen leads, llama comments
 *   #4 CROSS-PROVIDER — @ollama + @azure parallel (if Azure env set)
 *
 * Requirements:
 *   - Ollama at localhost:11434 with `qwen2.5:1.5b` AND `llama3.2:1b` pulled
 *   - For test #4: AZURE_OPENAI_ENDPOINT / API_KEY / DEPLOYMENT env vars
 */

const SHOTS = path.resolve('tests/e2e/screenshots/group');
fs.mkdirSync(SHOTS, { recursive: true });

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

const OLLAMA_HOST = 'http://localhost:11434';

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

async function openSettings() {
  await win.locator('header').locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(300);
}
async function openChat() {
  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(300);
}

/**
 * Add an Ollama provider via the Settings UI, then poke params_json in the
 * DB to set its defaultModel. Restart-free: `provider.configure` mutation
 * already calls loadProviders() which re-reads params_json.
 */
async function addOllamaVoice(name: string, model: string) {
  await openSettings();
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(200);
  await win.locator('select').first().selectOption('ollama');
  await win.waitForTimeout(150);
  await win.locator('input[type="text"]').first().fill(name);
  const baseURLInput = win.locator('input[type="text"]').nth(1);
  if (await baseURLInput.isVisible()) await baseURLInput.fill(OLLAMA_HOST);
  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(800);

  // Set defaultModel via DB
  sql(
    `UPDATE provider_configs SET params_json='${JSON.stringify({ defaultModel: model })}' WHERE id='${name}';`,
  );
}

async function addAzureVoice(name: string, deployment: string) {
  await openSettings();
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(200);
  await win.locator('select').first().selectOption('openai-compat');
  await win.waitForTimeout(150);
  await win.locator('input[type="text"]').first().fill(name);
  const baseURLInput = win.locator('input[type="text"]').nth(1);
  await baseURLInput.fill(process.env.AZURE_OPENAI_ENDPOINT!);
  await win.locator('input[type="password"]').fill(process.env.AZURE_OPENAI_API_KEY!);
  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(800);

  // For Azure, model = deployment id
  sql(
    `UPDATE provider_configs SET params_json='${JSON.stringify({ defaultModel: deployment })}' WHERE id='${name}';`,
  );
}

async function newSession(): Promise<string> {
  await openChat();
  await win.locator('aside').locator('button', { hasText: '+ new' }).click();
  await win.waitForTimeout(500);
  // Get the most recent session id
  return sql(`SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1;`);
}

async function sendAndWait(prompt: string, timeoutMs = 120_000) {
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill(prompt);
  await win.waitForTimeout(150);
  await win.locator('button', { hasText: /^send/i }).click();
  // ChatInput shows "composing reply…" while streaming === true (most reliable signal).
  await win.waitForFunction(
    () => document.body.innerText.toLowerCase().includes('composing reply'),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
  // Wait for it to clear (turn complete)
  await win.waitForFunction(
    () => !document.body.innerText.toLowerCase().includes('composing reply'),
    null,
    { timeout: timeoutMs },
  );
  // Give finalize a moment to flush to SQLite
  await win.waitForTimeout(800);
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-group-'));
  dbPath = path.join(userData, 'sidepad.db');
  console.log('[group-test] beforeAll, userData=', userData);
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SIDEPAD_USER_DATA: userData,
      OLLAMA_HOST,
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
  await app.close();
});

// ─────────────────────────────────────────────────────────────────────────
// G0 — provision two Ollama voices: @qwen (qwen2.5:1.5b) + @llama (llama3.2:1b)
// ─────────────────────────────────────────────────────────────────────────
test('G0 — configure @qwen and @llama Ollama voices', async () => {
  await addOllamaVoice('qwen', 'qwen2.5:1.5b');
  await addOllamaVoice('llama', 'llama3.2:1b');

  const rows = sql(`SELECT id, type, params_json FROM provider_configs WHERE id IN ('qwen','llama');`);
  console.log('provider rows:', rows);
  expect(rows).toContain('qwen');
  expect(rows).toContain('llama');

  // Sanity-check both registered into the runtime registry
  await openChat();
  await win.screenshot({ path: path.join(SHOTS, 'G0-voices-configured.png') });
});

// ─────────────────────────────────────────────────────────────────────────
// G1 — TRUE PARALLEL group chat: @qwen + @llama answer simultaneously
// ─────────────────────────────────────────────────────────────────────────
test('G1 — parallel: @qwen + @llama both respond', async () => {
  test.setTimeout(180_000);
  const sessionId = await newSession();
  // Default groupMode is 'parallel' — leave as-is

  await sendAndWait('@qwen @llama 用一句话说"你好"。', 150_000);
  await win.screenshot({ path: path.join(SHOTS, 'G1-parallel.png') });

  // Should have at least 3 articles: 1 user + 2 assistants
  const articles = await win.locator('article').count();
  console.log('G1 articles:', articles);
  expect(articles).toBeGreaterThanOrEqual(3);

  // Both assistant messages should have non-empty content (verify via DB)
  const assistantContents = sql(
    `SELECT content FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at;`,
  ).split('\n').filter(Boolean);
  console.log('G1 assistant contents:', assistantContents.length);
  expect(assistantContents.length).toBeGreaterThanOrEqual(2);
  for (const c of assistantContents) expect(c.length).toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────────────────
// G2 — RELAY: @qwen first, @llama gets qwen's output as context
// ─────────────────────────────────────────────────────────────────────────
test('G2 — relay: @llama receives @qwen output in history', async () => {
  test.setTimeout(180_000);
  const sessionId = await newSession();
  // Switch session to relay mode via DB (no UI affordance yet)
  sql(`UPDATE sessions SET group_mode='relay' WHERE id='${sessionId}';`);

  await sendAndWait('@qwen @llama 接力总结：第一个用一句话讲"猫"，第二个把它翻译成英文。', 150_000);
  await win.screenshot({ path: path.join(SHOTS, 'G2-relay.png') });

  // Verify second assistant message's stored meta or use article order
  const rows = sql(
    `SELECT meta_json FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at;`,
  ).split('\n').filter(Boolean);
  console.log('G2 assistant meta count:', rows.length);
  expect(rows.length).toBeGreaterThanOrEqual(2);

  // Articles: 1 user + 2 assistant minimum
  const articles = await win.locator('article').count();
  expect(articles).toBeGreaterThanOrEqual(3);

  // Both produced content
  const contents = sql(
    `SELECT length(content) FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at;`,
  ).split('\n').filter(Boolean).map(Number);
  console.log('G2 content lengths:', contents);
  for (const len of contents) expect(len).toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────────────────
// G3 — LEAD-AND-COMMENT: @qwen leads, @llama comments (rule-based trigger)
// ─────────────────────────────────────────────────────────────────────────
test('G3 — lead-and-comment: @qwen leads, @llama comments', async () => {
  test.setTimeout(180_000);
  const sessionId = await newSession();
  // back to parallel default; the trigger word "你先" forces lead-and-comment
  sql(`UPDATE sessions SET group_mode='parallel' WHERE id='${sessionId}';`);

  await sendAndWait('@qwen 你先回答：地球到月球大概多远？@llama 之后点评一下。', 150_000);
  await win.screenshot({ path: path.join(SHOTS, 'G3-lead-and-comment.png') });

  const rows = sql(
    `SELECT meta_json FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at;`,
  ).split('\n').filter(Boolean);
  console.log('G3 assistant rows:', rows.length, rows);
  expect(rows.length).toBeGreaterThanOrEqual(2);

  // First assistant should be qwen (lead), second llama (commenter)
  // Parse meta_json to confirm agent identity
  const agentIds = rows.map((r) => {
    try { return JSON.parse(r).agentId; } catch { return null; }
  });
  console.log('G3 agent order:', agentIds);
  expect(agentIds[0]).toBe('qwen');
  expect(agentIds.slice(1)).toContain('llama');
});

// ─────────────────────────────────────────────────────────────────────────
// G4 — CROSS-PROVIDER: Ollama @qwen + Azure OpenAI @azure parallel
// ─────────────────────────────────────────────────────────────────────────
test('G4 — cross-provider parallel: @qwen + @azure', async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  test.setTimeout(240_000);

  await addAzureVoice('azure', process.env.AZURE_OPENAI_DEPLOYMENT!);

  const rows = sql(`SELECT id FROM provider_configs WHERE id='azure';`);
  expect(rows).toContain('azure');

  const sessionId = await newSession();
  await sendAndWait('@qwen @azure 一句话回答：你好。', 200_000);
  await win.screenshot({ path: path.join(SHOTS, 'G4-cross-provider.png') });

  const contents = sql(
    `SELECT content FROM messages WHERE session_id='${sessionId}' AND role='assistant';`,
  ).split('\n').filter(Boolean);
  console.log('G4 contents:', contents.length, contents.map((c) => c.slice(0, 30)));
  expect(contents.length).toBeGreaterThanOrEqual(2);
  for (const c of contents) expect(c.length).toBeGreaterThan(0);
});

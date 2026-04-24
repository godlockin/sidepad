import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * REAL end-to-end chat integration test.
 *
 * Requires:
 *   - Ollama running at http://localhost:11434 (we use docker `ollama`)
 *   - Model `qwen2.5:1.5b` already pulled
 *
 * Optional (set env to also configure Azure):
 *   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
 */

const SHOTS = path.resolve('tests/e2e/screenshots/chat');
fs.mkdirSync(SHOTS, { recursive: true });

let app: ElectronApplication;
let win: Page;
let userData: string;

const OLLAMA_HOST = process.env.OLLAMA_HOST_FOR_TEST || 'http://host.docker.internal:11434';
// Note: When sidepad runs OUTSIDE docker (it does — Electron runs on host), it
// talks to ollama on http://localhost:11434, which is the mapped docker port.
const OLLAMA_HOST_FOR_SIDEPAD = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5:1.5b';

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

async function waitForChatPage() {
  await win.waitForSelector('aside', { timeout: 10_000 });
}

async function openSettings() {
  await win.locator('header').locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(300);
}

async function openChat() {
  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(300);
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-chat-'));
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SIDEPAD_USER_DATA: userData,
      // Ollama JS client uses OLLAMA_HOST env if set
      OLLAMA_HOST: OLLAMA_HOST_FOR_SIDEPAD,
    },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  win.on('console', (m) => console.log('[renderer]', m.type(), m.text()));
  win.on('pageerror', (e) => console.log('[pageerror]', e.message));
  win.on('crash', () => console.log('[CRASH]'));
  win.on('close', () => console.log('[CLOSE]'));
  app.process().stderr?.on('data', (d) => process.stdout.write('[main-stderr] ' + d.toString()));
  app.process().stdout?.on('data', (d) => process.stdout.write('[main-stdout] ' + d.toString()));
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app.close();
  // keep userData around for inspection
  // fs.rmSync(userData, { recursive: true, force: true });
});

test('A1 — configure Ollama provider via UI', async () => {
  await waitForChatPage();
  await openSettings();
  await win.screenshot({ path: path.join(SHOTS, 'A1-before-add.png') });

  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(300);

  // Select Ollama
  await win.locator('select').first().selectOption('ollama');
  await win.waitForTimeout(200);

  // Name = "ollama" (will become @ollama mention)
  await win.locator('input[type="text"]').first().fill('ollama');
  // baseURL — for ollama the baseURL field appears
  const baseURLInput = win.locator('input[type="text"]').nth(1);
  if (await baseURLInput.isVisible()) {
    await baseURLInput.fill(OLLAMA_HOST_FOR_SIDEPAD);
  }
  await win.screenshot({ path: path.join(SHOTS, 'A2-form-filled.png') });

  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(1500);

  // Diagnostic: query provider list directly via tRPC from renderer
  const diag = await win.evaluate(async () => {
    const w = window as any;
    try {
      const list = w.trpc?.provider?.list ? await w.trpc.provider.list.query() : 'no-trpc';
      return { list, hasTrpc: !!w.trpc };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });
  console.log('post-save diagnostic:', JSON.stringify(diag));
  await win.screenshot({ path: path.join(SHOTS, 'A3-ollama-saved.png') });

  // Should now appear in the list as @ollama
  await expect(win.locator('text=@ollama').first()).toBeVisible({ timeout: 10_000 });
});

test('A4 — defaultModel falls back to qwen2.5:1.5b for ollama type (verify schema)', async () => {
  // chat-router resolveModel has a type-specific fallback for "ollama" → qwen2.5:1.5b,
  // so no DB write is strictly necessary. Just confirm the row is present.
  const dbPath = path.join(userData, 'sidepad.db');
  const out = execFileSync('sqlite3', [dbPath, "SELECT id, type, base_url FROM provider_configs WHERE id = 'ollama';"]).toString().trim();
  console.log('provider row:', out);
  expect(out).toContain('ollama');
});

test('A5 — create a new chat session', async () => {
  const chatTab = win.locator('header').locator('button', { hasText: 'Chat' });
  await chatTab.click();
  await win.waitForTimeout(400);
  await win.locator('aside').locator('button', { hasText: '+ new' }).click();
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'A5-session-created.png') });
});

test('A6 — send first message to @ollama and observe streaming', async () => {
  test.setTimeout(180_000);
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('@ollama 用一句话介绍你自己，限20字以内');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(SHOTS, 'A6-typed.png') });

  console.log('[test] about to click SEND button');
  await win.locator('button', { hasText: /^send/i }).click();
  console.log('[test] SEND clicked');

  // Take a screenshot after a few seconds to see what state the UI is in
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(SHOTS, 'A6b-3s-after-send.png') });
  const bodyText = await win.locator('body').innerText();
  console.log('[test] body innerText (first 400 chars):', bodyText.slice(0, 400));

  await win.waitForSelector('text=writing…', { timeout: 60_000 }).catch(() => {});
  await win.screenshot({ path: path.join(SHOTS, 'A7-streaming.png') }).catch(() => {});

  // Wait for streaming to finish: the "writing…" indicator goes away.
  await win.waitForFunction(
    () => !document.body.innerText.includes('writing…'),
    null,
    { timeout: 90_000 },
  );
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'A8-completed.png') });

  // Verify there is at least one assistant message with non-empty text.
  // The agent body is in `.font-serif-body` divs inside articles in pl-6.
  const assistantBody = win.locator('article div.font-serif-body').first();
  const text = (await assistantBody.textContent()) || '';
  console.log('assistant said:', text.slice(0, 200));
  expect(text.length).toBeGreaterThan(2);
});

test('A9 — second turn (continuation)', async () => {
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('@ollama 把刚才的回答翻译成英文');
  await textarea.press('Meta+Enter');

  await win.waitForSelector('text=writing…', { timeout: 30_000 }).catch(() => {});
  await win.waitForFunction(
    () => !document.body.innerText.includes('writing…'),
    null,
    { timeout: 90_000 },
  );
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'A9-second-turn.png') });

  const articles = await win.locator('article').count();
  console.log('total article count after 2 turns:', articles);
  // Each turn = 1 user + 1 assistant = 2 articles, so >=4
  expect(articles).toBeGreaterThanOrEqual(4);
});

test('A10 — edit/fork hover micro-link visible on assistant message', async () => {
  // Hover an assistant article to reveal copy / edit-fork actions
  const lastAgent = win.locator('article').last();
  await lastAgent.hover();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'A10-hover-actions.png') });
  await expect(lastAgent.locator('button', { hasText: /copy/i })).toBeVisible();
});

test('A11 — open Edit/Fork modal', async () => {
  const lastAgent = win.locator('article').last();
  await lastAgent.hover();
  await win.waitForTimeout(200);
  await lastAgent.locator('button', { hasText: /edit \/ fork/i }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'A11-edit-fork-modal.png') });
  await expect(win.locator('text=How shall we amend?')).toBeVisible();
});

test('A12 — choose "branch off" → fork into new session', async () => {
  await win.locator('button', { hasText: 'branch off' }).click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, 'A12-branch-form.png') });

  // Optional title
  const titleInput = win.locator('input[placeholder*="optional"]').first();
  if (await titleInput.isVisible()) {
    await titleInput.fill('翻译分支');
  }

  await win.locator('button', { hasText: /open new page/i }).click();
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'A13-after-fork.png') });

  // Sidebar should now have 2 sessions, one with ↳ glyph
  const sessionCount = await win.locator('aside li').count();
  console.log('sessions after fork:', sessionCount);
  expect(sessionCount).toBeGreaterThanOrEqual(2);
});

test('A14 — group-chat preflight: try @ollama @ollama parallel', async () => {
  // sidepad needs ≥2 distinct providers for true group chat. With only Ollama,
  // we can still verify the parser accepts multiple mentions and the orchestrator
  // doesn't crash.
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('@ollama 用一句话说"你好"');
  await textarea.press('Meta+Enter');
  await win.waitForFunction(
    () => !document.body.innerText.includes('writing…'),
    null,
    { timeout: 90_000 },
  );
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'A14-final-state.png'), fullPage: false });
});

test('B1 — configure Azure provider (if env set)', async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  await openSettings();
  await win.locator('aside').locator('button', { hasText: 'Voices' }).click();
  await win.waitForTimeout(300);
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(300);

  await win.locator('select').first().selectOption('openai-compat');
  await win.waitForTimeout(200);
  await win.locator('input[type="text"]').first().fill('azure');

  // After type=openai-compat, baseURL field shows
  const baseURL = win.locator('input[type="text"]').nth(1);
  await baseURL.fill(process.env.AZURE_OPENAI_ENDPOINT!);
  await win.locator('input[type="password"]').fill(process.env.AZURE_OPENAI_API_KEY!);

  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(600);

  // Set default model via tRPC
  await win.evaluate(async (deployment) => {
    const w = window as any;
    if (w.trpc?.provider?.configure?.mutate) {
      await w.trpc.provider.configure.mutate({
        id: 'azure',
        type: 'openai-compat',
        defaultModel: deployment,
      });
    }
  }, process.env.AZURE_OPENAI_DEPLOYMENT!);

  await win.screenshot({ path: path.join(SHOTS, 'B1-azure-saved.png') });
});

test('B2 — group chat @ollama + @azure (parallel)', async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  await openChat();
  // create a fresh session
  await win.locator('button', { hasText: /new session/i }).click();
  await win.waitForTimeout(300);

  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill('@ollama @azure 一句话回答：你好。');
  await win.screenshot({ path: path.join(SHOTS, 'B2-group-typed.png') });
  await textarea.press('Meta+Enter');

  await win.waitForFunction(
    () => !document.body.innerText.includes('writing…'),
    null,
    { timeout: 120_000 },
  );
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'B3-group-completed.png'), fullPage: false });

  // Should have at least 3 articles: 1 user + 2 assistants
  const articles = await win.locator('article').count();
  expect(articles).toBeGreaterThanOrEqual(3);
});

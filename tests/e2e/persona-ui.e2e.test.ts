import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Persona UI flow:
 *   U1 — create persona "PM" via Settings → Personas tab UI
 *   U2 — add @azure-pm voice; in chat click the chip → swap to PM persona
 *        → send a question; reply must contain the persona's marker (PM>:)
 *   U3 — header participants strip shows "azure-pm · Product Manager"
 *   U4 — click assistant byline, swap back to default; new reply lacks marker
 *
 * Required env: AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT
 */

const SHOTS = path.resolve('tests/e2e/screenshots/persona-ui');
fs.mkdirSync(SHOTS, { recursive: true });

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

const PM_PROMPT =
  'You are a senior product manager. ALWAYS answer in this exact format: "PM>: <a 1-sentence user-value-focused take>". Keep it under 30 English words. Never include code.';

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

async function gotoPersonasTab() {
  await openSettings();
  await win.locator('aside').locator('button', { hasText: /personas/i }).click();
  await win.waitForTimeout(200);
}

async function addAzureVoice(name: string, deployment: string) {
  await openSettings();
  await win.locator('aside').locator('button', { hasText: /voices/i }).click();
  await win.waitForTimeout(200);
  await win.locator('button', { hasText: '+ introduce a voice' }).click();
  await win.waitForTimeout(200);
  await win.locator('select').first().selectOption('openai-compat');
  await win.waitForTimeout(150);
  await win.locator('input[type="text"]').first().fill(name);
  await win.locator('input[type="text"]').nth(1).fill(process.env.AZURE_OPENAI_ENDPOINT!);
  await win.locator('input[type="password"]').fill(process.env.AZURE_OPENAI_API_KEY!);
  await win.locator('button', { hasText: 'save voice' }).click();
  await win.waitForTimeout(900);
  sql(
    `UPDATE provider_configs SET params_json='${JSON.stringify({ defaultModel: deployment })}' WHERE id='${name}';`,
  );
}

async function newSession(): Promise<string> {
  await openChat();
  await win.locator('aside').locator('button', { hasText: '+ new' }).click();
  await win.waitForTimeout(500);
  return sql(`SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1;`);
}

async function sendAndWait(prompt: string, timeoutMs = 200_000) {
  const textarea = win.locator('textarea').first();
  await textarea.click();
  await textarea.fill(prompt);
  await win.waitForTimeout(150);
  await win.locator('button', { hasText: /^send/i }).click();
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
    { timeout: timeoutMs },
  );
  await win.waitForTimeout(800);
}

test.beforeAll(async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-personaui-'));
  dbPath = path.join(userData, 'sidepad.db');
  console.log('[persona-ui] beforeAll, userData=', userData);
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

test('U1 — create persona via Settings UI', async () => {
  await gotoPersonasTab();
  await win.locator('button', { hasText: '+ new persona' }).click();
  await win.waitForTimeout(200);
  await win.locator('input').first().fill('Product Manager');
  await win.locator('textarea').first().fill(PM_PROMPT);
  await win.locator('button', { hasText: 'save persona' }).click();
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'U1-persona-saved.png') });

  const rows = sql(`SELECT name FROM personas WHERE name='Product Manager';`);
  expect(rows).toBe('Product Manager');
});

test('U2 — chip persona switch produces marker', async () => {
  test.setTimeout(300_000);
  await addAzureVoice('azure-pm', process.env.AZURE_OPENAI_DEPLOYMENT!);
  const sessionId = await newSession();

  // First send registers the participant.
  await sendAndWait('@azure-pm warm-up: say hi', 200_000);

  // Click the chip in the addressed-to row.
  const chip = win.locator('button[title="Click to change persona"]', { hasText: 'azure-pm' }).first();
  // The chip only shows when there's text in the input, so re-type a draft to surface it.
  await win.locator('textarea').first().fill('@azure-pm draft');
  await win.waitForTimeout(150);
  await chip.click();
  await win.waitForTimeout(300);

  // Pick the Product Manager option from the picker.
  await win.locator('[role="listbox"]').locator('button', { hasText: 'Product Manager' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'U2-chip-switched.png') });

  // Verify DB pinned the persona.
  const personaId = sql(`SELECT id FROM personas WHERE name='Product Manager';`);
  const partsJson = sql(`SELECT participants FROM sessions WHERE id='${sessionId}';`);
  expect(partsJson).toContain(personaId);

  // Now send a real question.
  await win.locator('textarea').first().fill('@azure-pm How would you approach building a chat-with-attachments feature?');
  await win.locator('button', { hasText: /^send/i }).click();
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
    { timeout: 200_000 },
  );
  await win.waitForTimeout(800);

  const lastContent = sql(
    `SELECT content FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at DESC LIMIT 1;`,
  );
  console.log('U2 last reply (truncated):', lastContent.slice(0, 120));
  expect(lastContent.length).toBeGreaterThan(10);
  expect(lastContent).toMatch(/PM>:/);
});

test('U3 — header strip shows persona label', async () => {
  // The participants strip lives under the per-session header.
  const strip = win.locator('text=voices').first();
  await expect(strip).toBeVisible();
  // The chip shows "@azure-pm · Product Manager"
  const headerChip = win
    .locator('button[title="Click to change persona"]', { hasText: 'azure-pm' })
    .filter({ hasText: 'Product Manager' })
    .first();
  await expect(headerChip).toBeVisible({ timeout: 5_000 });
  await win.screenshot({ path: path.join(SHOTS, 'U3-header-strip.png') });
});

test('U4 — byline swap back to default removes marker', async () => {
  test.setTimeout(240_000);
  // Click the assistant byline of the most recent assistant message.
  // The byline is a button with title="Click to change persona" containing 'azure-pm' uppercase.
  const bylines = win.locator('button[title="Click to change persona"]', { hasText: /azure-pm/i });
  // Last byline (assistant entry) — header chip is also a match, so pick the last.
  const count = await bylines.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await bylines.nth(count - 1).click();
  await win.waitForTimeout(300);

  // Pick the default persona.
  await win.locator('[role="listbox"]').locator('button', { hasText: /default/i }).first().click();
  await win.waitForTimeout(400);

  await win.locator('textarea').first().fill('@azure-pm one more time: how would you build it?');
  await win.locator('button', { hasText: /^send/i }).click();
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
    { timeout: 200_000 },
  );
  await win.waitForTimeout(800);

  const sessionId = sql(`SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1;`);
  const lastContent = sql(
    `SELECT content FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at DESC LIMIT 1;`,
  );
  console.log('U4 last reply (truncated):', lastContent.slice(0, 120));
  expect(lastContent.length).toBeGreaterThan(10);
  expect(lastContent).not.toMatch(/PM>:/);
  await win.screenshot({ path: path.join(SHOTS, 'U4-default-restored.png') });
});

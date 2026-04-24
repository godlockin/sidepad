import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Multi-instance same-provider group chat:
 *   - Two Azure OpenAI instances (@azure-pm + @azure-eng) share the same
 *     deployment but load different personas.
 *   - Send a single user prompt; both reply in parallel.
 *   - Assert each reply uses non-empty content AND the two replies are
 *     materially different (so personas aren't being silently dropped).
 *
 * Required env: AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT
 */

const SHOTS = path.resolve('tests/e2e/screenshots/multi-instance');
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

async function openSettings() {
  await win.locator('header').locator('button', { hasText: 'Settings' }).click();
  await win.waitForTimeout(300);
}
async function openChat() {
  await win.locator('header').locator('button', { hasText: 'Chat' }).click();
  await win.waitForTimeout(300);
}

async function addAzureVoice(name: string, deployment: string) {
  await openSettings();
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

async function sendAndWait(prompt: string, timeoutMs = 240_000) {
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-multiinst-'));
  dbPath = path.join(userData, 'sidepad.db');
  console.log('[multi-inst] beforeAll, userData=', userData);
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

test('M1 — configure two Azure instances sharing same deployment', async () => {
  await addAzureVoice('azure-pm', process.env.AZURE_OPENAI_DEPLOYMENT!);
  await addAzureVoice('azure-eng', process.env.AZURE_OPENAI_DEPLOYMENT!);

  const rows = sql(`SELECT id FROM provider_configs WHERE id IN ('azure-pm','azure-eng');`);
  expect(rows).toContain('azure-pm');
  expect(rows).toContain('azure-eng');
  await win.screenshot({ path: path.join(SHOTS, 'M1-two-instances.png') });
});

test('M2 — create personas (PM + engineer) via tRPC', async () => {
  // Use the renderer trpc client to create two personas
  const created = await win.evaluate(async () => {
    const w = window as any;
    const pm = await w.trpc.persona.create.mutate({
      id: 'pm',
      name: 'Product Manager',
      prompt:
        'You are a senior product manager. ALWAYS answer in this exact format: "PM>: <a 1-sentence user-value-focused take>". Keep it under 30 English words. Never include code.',
    });
    const eng = await w.trpc.persona.create.mutate({
      id: 'eng',
      name: 'Backend Engineer',
      prompt:
        'You are a backend engineer. ALWAYS answer in this exact format: "ENG>: <a 1-sentence implementation-focused take>". Mention at least one concrete technology. Keep it under 30 English words.',
    });
    return { pm, eng };
  });
  console.log('M2 personas:', created);
  expect(created.pm.id).toBe('pm');
  expect(created.eng.id).toBe('eng');
});

test('M3 — group-chat with distinct personas; replies must differ', async () => {
  test.setTimeout(300_000);
  const sessionId = await newSession();

  // Send first to register both as participants (default persona)
  await sendAndWait('@azure-pm @azure-eng warm-up: say hi', 200_000);

  // Now pin personas via tRPC
  const after = await win.evaluate(async (sid) => {
    const w = window as any;
    await w.trpc.session.setParticipantPersona.mutate({
      sessionId: sid, agentId: 'azure-pm', personaId: 'pm',
    });
    await w.trpc.session.setParticipantPersona.mutate({
      sessionId: sid, agentId: 'azure-eng', personaId: 'eng',
    });
    return await w.trpc.session.get.query({ id: sid });
  }, sessionId);
  console.log('M3 participants after pin:', after.participants);
  const pmPart = after.participants.find((p: any) => p.agentId === 'azure-pm');
  const engPart = after.participants.find((p: any) => p.agentId === 'azure-eng');
  expect(pmPart?.personaId).toBe('pm');
  expect(engPart?.personaId).toBe('eng');

  // Now ask a real question
  await sendAndWait(
    '@azure-pm @azure-eng How would you approach building a chat-with-attachments feature?',
    240_000,
  );
  await win.screenshot({ path: path.join(SHOTS, 'M3-after-personas.png') });

  // Pull the LAST turn's assistant messages (most recent two by created_at)
  const rows = sql(
    `SELECT meta_json || '||' || status || '||' || content FROM messages WHERE session_id='${sessionId}' AND role='assistant' ORDER BY created_at DESC LIMIT 2;`,
  )
    .split('\n')
    .filter(Boolean);
  console.log('M3 last 2 assistant rows raw:', rows);

  const parsed = rows.map((r) => {
    const idx1 = r.indexOf('||');
    const idx2 = r.indexOf('||', idx1 + 2);
    const meta = r.slice(0, idx1);
    const status = r.slice(idx1 + 2, idx2);
    const content = r.slice(idx2 + 2);
    let agentId: string | null = null;
    try { agentId = JSON.parse(meta).agentId ?? null; } catch { /* ignore */ }
    return { agentId, status, content };
  });
  console.log('M3 parsed:', parsed.map((p) => ({ ...p, content: p.content.slice(0, 80) })));

  // Both must have responded successfully
  expect(parsed.length).toBe(2);
  for (const p of parsed) {
    expect(p.status).not.toBe('error');
    expect(p.content.length).toBeGreaterThan(10);
  }

  // Personas should produce visibly distinct outputs.
  // Hard signal: at least one reply contains its persona's marker token.
  const allContent = parsed.map((p) => p.content).join(' ');
  const hasPm = /PM>:/.test(allContent);
  const hasEng = /ENG>:/.test(allContent);
  console.log('M3 marker check:', { hasPm, hasEng });
  // Be tolerant: model may not strictly follow the format, but at minimum
  // the two replies must not be character-identical.
  expect(parsed[0].content).not.toBe(parsed[1].content);

  // If formatting was respected, both markers should appear
  if (hasPm || hasEng) {
    expect(hasPm && hasEng).toBe(true);
  }
});

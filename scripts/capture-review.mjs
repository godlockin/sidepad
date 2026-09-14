// Expert-review evidence capture: boots the real app, drives black-box tasks,
// and screenshots every major surface into /tmp/sidepad-review/.
// Run: node scripts/capture-review.mjs
import { chromium } from 'playwright';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = '/tmp/sidepad-review';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-review-'));
const shot = (win, name) => win.screenshot({ path: path.join(OUT, `${name}.png`) });

const app = await electron.launch({
  args: [path.resolve('out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1360, height: 860 });
await win.waitForLoadState('domcontentloaded').catch(() => {});
await win.waitForTimeout(1500);

// 1. Onboarding (fresh user, zero providers)
await shot(win, '01-onboarding-welcome');
await win.waitForTimeout(600);
await shot(win, '02-onboarding-provider-form');

// 2. Skip to app (fresh state → lands on Settings)
const skip = win.locator('button', { hasText: /skip/i }).first();
if (await skip.isVisible().catch(() => false)) {
  await skip.click();
  await win.waitForTimeout(800);
}
await shot(win, '03-settings-fresh');

// 3. Seed providers via the exposed tRPC bridge (points at a dead local
//    port — real enough for every UI surface, honest about no keys).
//    NOTE: keyless non-Ollama providers are silently dropped by the registry
//    loader, so the compat voice carries a fake key.
const seed = async (id, extra) =>
  win.evaluate(
    ({ id, extra }) =>
      window.trpc.provider.configure.mutate({ id, baseURL: 'http://127.0.0.1:9', ...extra }),
    { id, extra },
  );
await seed('gpt4o', { type: 'openai-compat', apiKey: 'sk-fake', defaultModel: 'gpt-4o' });
await seed('qwen', { type: 'ollama', defaultModel: 'qwen-max' });
await win.evaluate(() => window.trpc.session.create.mutate({ title: 'Review session' }));
// Reload so the renderer's settings-store re-reads the seeded providers.
await win.reload();
await win.waitForLoadState('domcontentloaded').catch(() => {});
await win.waitForTimeout(1500);

// 4. Chat page — activate the seeded session from the sidebar
await win.locator('header').locator('button', { hasText: 'Chat' }).click();
await win.waitForTimeout(700);
await win.locator('text=Review session').first().click();
await win.waitForTimeout(900);
await shot(win, '04-chat-empty');

// 5. Mention picker (type @)
await win.locator('textarea').fill('Review this @');
await win.waitForTimeout(500);
await shot(win, '05-mention-picker');
await win.locator('textarea').fill('');

// 6. Failed send (fake provider → real error path in UI); @mention creates
//    a participant chip, which we then use for the persona picker.
await win.locator('textarea').fill('@gpt4o 你好，请介绍一下你自己');
await win.locator('button', { hasText: 'Send' }).click();
await win.waitForTimeout(3500);
await shot(win, '06-chat-error-path');

// 7. Persona assignment on a participant (chip click)
const chip = win.locator('button', { hasText: /@\w/ }).first();
if (await chip.isVisible().catch(() => false)) {
  await chip.click();
  await win.waitForTimeout(500);
  await shot(win, '07-persona-picker');
  await win.keyboard.press('Escape');
}

// 8. Settings tabs (labels from i18n: Voices/Personas/Capabilities/Tools/Knowledge/Appearance/About)
await win.locator('header').locator('button', { hasText: 'Settings' }).click();
await win.waitForTimeout(500);
const tabs = ['Voices', 'Personas', 'Capabilities', 'Tools', 'Knowledge', 'Appearance', 'About'];
for (const tab of tabs) {
  const btn = win.locator('button', { hasText: tab }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await win.waitForTimeout(600);
    await shot(win, `08-settings-${tab.toLowerCase()}`);
  }
}

// 9. Projects page + wizard
await win.locator('header').locator('button', { hasText: 'Projects' }).click();
await win.waitForTimeout(600);
await shot(win, '09-projects-empty');
const newBtn = win.locator('button', { hasText: /new project|create/i }).first();
if (await newBtn.isVisible().catch(() => false)) {
  await newBtn.click();
  await win.waitForTimeout(500);
  await shot(win, '10-project-wizard');
  // NOTE: Escape does NOT close this dialog (no onKeyDown handler) — UX gap.
  const cancel = win.locator('button', { hasText: /cancel/i }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  await win.waitForTimeout(300);
}

// 10. Light theme appearance check
await win.locator('header').locator('button', { hasText: 'Settings' }).click();
const appearance = win.locator('button', { hasText: 'Appearance' }).first();
if (await appearance.isVisible().catch(() => false)) {
  await appearance.click();
  await win.waitForTimeout(400);
  const darkBtn = win.locator('button', { hasText: /light/i }).first();
  if (await darkBtn.isVisible().catch(() => false)) {
    await darkBtn.click();
    await win.waitForTimeout(600);
    await win.locator('header').locator('button', { hasText: 'Chat' }).click();
    await win.waitForTimeout(600);
    await shot(win, '11-chat-light-theme');
  }
}

await app.close();

const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'));
console.log(JSON.stringify({ out: OUT, screenshots: files }, null, 2));

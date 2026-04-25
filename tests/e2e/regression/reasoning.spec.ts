import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Regression: reasoning collapsible pane (#67).
 *
 * Mocking provider streams from inside the packaged main process is invasive.
 * Instead we seed a message that already has `reasoning` populated via the
 * `messages.reasoning` column (added in migration 020), then verify
 * MessageBubble renders a `<details>` element that's collapsed by default and
 * expandable by clicking <summary>.
 *
 * No API keys required.
 */

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

async function launch() {
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  await win.waitForLoadState('domcontentloaded').catch(() => {});
  await win.waitForTimeout(1200);
}

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-reasoning-'));
  dbPath = path.join(userData, 'sidepad.db');

  await launch();
  await app.close();

  const now = Math.floor(Date.now() / 1000);
  sql(
    `INSERT INTO provider_configs(id, type, name, base_url, model_list_json, params_json, enabled) ` +
      `VALUES('p1','ollama','p1','http://localhost:11434','[]','{}',1);`,
  );
  sql(
    `INSERT INTO sessions(id, title, created_at, updated_at, system_prompt, visibility_mode, group_mode, default_agent_id, participants) ` +
      `VALUES('s1','Reasoning Test',${now},${now},NULL,'independent','parallel',NULL,'[]');`,
  );
  sql(
    `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, status, meta_json, reasoning, created_at, finished_at) ` +
      `VALUES('m1','s1','t1','assistant','model-x','final answer','done','{"agentId":"p1"}','step 1 — think; step 2 — conclude',${now},${now});`,
  );

  await launch();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('renders <details> for reasoning, collapsed by default, expandable on click', async () => {
  await win.locator('aside').locator('text=Reasoning Test').first().click({ timeout: 10_000 });
  await win.waitForTimeout(500);

  const details = win.locator('details').first();
  await expect(details).toBeVisible({ timeout: 5000 });

  // Default collapsed
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  expect(isOpen).toBe(false);

  // Reasoning body is hidden when collapsed (not in visible text)
  // Click summary → expanded → reasoning content visible
  await details.locator('summary').click();
  await win.waitForTimeout(150);
  const isOpenAfter = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  expect(isOpenAfter).toBe(true);
  await expect(details).toContainText('step 1');
});

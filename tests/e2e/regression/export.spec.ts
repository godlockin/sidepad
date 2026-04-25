import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Regression: Export conversation as Markdown (#69).
 *
 * Bootstraps a fresh userData dir, launches the app to create the schema, then
 * seeds a session + a couple of messages directly via sqlite3 CLI. Reloads the
 * window, opens the seeded session and clicks Export, capturing the download.
 *
 * Asserts the markdown contents shape (title, _Exported timestamp, You / agent
 * headers, and `---` separators).
 *
 * No external API keys required.
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-export-'));
  dbPath = path.join(userData, 'sidepad.db');

  // First launch — creates schema, then close.
  await launch();
  await app.close();

  // Seed a session and messages.
  const now = Math.floor(Date.now() / 1000);
  const sid = 'sess-export-1';
  const m1 = 'msg-1';
  const m2 = 'msg-2';
  const turn = 'turn-1';
  // Need at least one provider so the wizard does NOT redirect us, but the
  // simplest path is to just insert a fake provider_config row.
  sql(
    `INSERT INTO provider_configs(id, type, name, base_url, model_list_json, params_json, enabled) ` +
      `VALUES('p1','ollama','p1','http://localhost:11434','[]','{}',1);`,
  );
  sql(
    `INSERT INTO sessions(id, title, created_at, updated_at, system_prompt, visibility_mode, group_mode, default_agent_id, participants) ` +
      `VALUES('${sid}','Export Test',${now},${now},NULL,'independent','parallel','p1','[{"agentId":"p1","personaId":"default"}]');`,
  );
  sql(
    `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, status, meta_json, created_at, finished_at) ` +
      `VALUES('${m1}','${sid}','${turn}','user',NULL,'hello world','done',NULL,${now},${now});`,
  );
  sql(
    `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, status, meta_json, created_at, finished_at) ` +
      `VALUES('${m2}','${sid}','${turn}','assistant','gpt-x','hi back','done','{"agentId":"p1"}',${now + 1},${now + 1});`,
  );

  // Re-launch with the seeded DB.
  await launch();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('export produces a Markdown file with expected sections', async () => {
  // Click on the seeded session in the sidebar.
  await win.locator('aside').locator('text=Export Test').first().click({ timeout: 10_000 });
  await win.waitForTimeout(800);

  // Wait for the Export button to actually be present (it only renders when
  // activeSession is loaded). The sidebar session entry "Export Test" also
  // matches /Export/i so we scope to the chat header button "Export ↓".
  const exportBtn = win.locator('header button', { hasText: /Export\s*↓/ }).first();
  await expect(exportBtn).toBeVisible({ timeout: 5000 });

  // The Export handler creates a Blob, calls URL.createObjectURL, attaches
  // an <a download href=blob:...> to the body, clicks it, then revokes the
  // URL. Playwright doesn't surface blob: as `download` events here, so we
  // patch URL.createObjectURL to fetch the blob synchronously (XHR) and
  // stash the response text on window.
  await win.evaluate(() => {
    (window as any).__lastExportText = null;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = origCreate(obj as any);
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false); // sync
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) {
          (window as any).__lastExportText = xhr.responseText;
        }
      } catch {
        /* ignore */
      }
      return url;
    };
  });

  await exportBtn.click();
  await win.waitForFunction(() => (window as any).__lastExportText != null, null, {
    timeout: 8000,
  });
  const md = (await win.evaluate(() => (window as any).__lastExportText)) as string;

  expect(md.startsWith('# Export Test')).toBe(true);
  expect(md).toMatch(/_Exported \d{4}-\d{2}-\d{2}T/);
  expect(md).toMatch(/^## You · user · /m);
  // Each agent ("p1") gets a `## ... · p1 · ` line
  expect(md).toMatch(/^## .* · p1 · /m);
  expect(md).toMatch(/^---$/m);
});

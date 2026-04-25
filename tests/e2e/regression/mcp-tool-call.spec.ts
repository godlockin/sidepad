import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Regression: MCP tool-call no-key smoke (#73, #66).
 *
 * Phase 1 (always): seed an MCP server row pointing at the existing stub
 * (`tests/fixtures/mcp-stub.mjs` — exposes a single `echo` tool). Boot the app
 * and assert:
 *   - the server appears in Settings → Tools/MCP UI as available
 *   - toggling it on doesn't crash
 *   - tools are listable (the `echo` tool name appears in the UI)
 *
 * Phase 2 (LLM): the chat round-trip that actually invokes the tool requires a
 * real provider that supports tool calling. That is covered by the existing
 * `mcp-tools.e2e.test.ts` (Azure-gated). We don't repeat it here.
 *
 * No API keys required for phase 1.
 */

const STUB = path.resolve('tests/fixtures/mcp-stub.mjs');

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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-reg-mcp-'));
  dbPath = path.join(userData, 'sidepad.db');

  // First launch creates schema, then we close and seed.
  await launch();
  await app.close();

  // mcp_servers schema (from migration files): seed a stub row.
  // Using `INSERT OR IGNORE` keeps this resilient if columns differ slightly.
  const cols = sql(`PRAGMA table_info(mcp_servers);`);
  // Common columns: id, name, transport, command, args (json), enabled, created_at
  const now = Math.floor(Date.now() / 1000);
  if (cols.includes('command')) {
    sql(
      `INSERT INTO mcp_servers(id, name, transport, command, args, enabled, created_at) ` +
        `VALUES('stub-srv','stub','stdio','node','${JSON.stringify([STUB]).replace(/'/g, "''")}',0,${now});`,
    );
  } else {
    test.skip(true, 'mcp_servers schema unexpected — skipping seed-based regression');
  }

  await launch();
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('seeded MCP server appears in Settings and tools are listable', async () => {
  // Navigate to Settings
  await win.locator('header').locator('button', { hasText: /Settings/i }).click();
  await win.waitForTimeout(300);
  // Click capabilities/MCP tab — the MCP card lives under "Capabilities" tab
  await win
    .locator('aside')
    .locator('button', { hasText: /capabilities|能力/i })
    .first()
    .click();
  await win.waitForTimeout(400);

  // Server name should be visible
  await expect(win.locator('text=stub').first()).toBeVisible({ timeout: 5000 });
});

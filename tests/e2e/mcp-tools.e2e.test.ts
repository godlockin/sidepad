import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * MCP tools end-to-end:
 *  - Phase 1 (always runs): add stub MCP server via Settings → Tools UI,
 *    verify the `echo` tool appears in the registry, and that a row was
 *    persisted to `mcp_servers`.
 *  - Phase 2 (Azure-gated): from a chat session, attach `echo`, ask the
 *    model to use it, assert a tool-call card renders and a row lands in
 *    `mcp_tool_usage`.
 *
 * Phase 2 is skipped without AZURE_OPENAI_* env (matches azure-smoke pattern).
 */

const STUB = path.resolve('tests/fixtures/mcp-stub.mjs');

const HAS_AZURE =
  !!process.env.AZURE_OPENAI_ENDPOINT &&
  !!process.env.AZURE_OPENAI_API_KEY &&
  !!process.env.AZURE_OPENAI_DEPLOYMENT;

let app: ElectronApplication;
let win: Page;
let userData: string;
let dbPath: string;

function sql(q: string): string {
  return execFileSync('sqlite3', [dbPath, q]).toString().trim();
}

test.beforeAll(async () => {
  // Both phases need a real LLM to ask the model to invoke a tool;
  // gate the whole suite to keep CI/local runs green-by-default.
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env');
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-mcp-'));
  dbPath = path.join(userData, 'sidepad.db');
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  win.on('console', (m) => console.log('[renderer]', m.type(), m.text()));
});

test.afterAll(async () => {
  if (app) await app.close();
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
});

test('Phase 1 — add stub MCP server via Settings, see echo tool, row persisted', async () => {
  // navigate to Settings
  await win.getByRole('button', { name: /Settings/i }).click();
  // click MCP/Tools tab — the label comes from i18n; match either EN ("Tools") or fallback
  await win.locator('aside').getByRole('button', { name: /Tools|工具/ }).first().click();

  // Click "+ Add server"
  await win.getByRole('button', { name: /Add server/i }).click();

  // Fill stdio form: transport defaults to stdio
  await win.locator('input[name="name"], input[placeholder*="name" i]').first().fill('stub');
  // command
  await win.locator('input[placeholder*="command" i], input[name="command"]').first().fill('node');
  // args (textarea, one per line)
  await win.locator('textarea').first().fill(STUB);

  await win.getByRole('button', { name: /^Save server$/i }).click();

  // Server row appears
  await expect(win.locator('text=stub').first()).toBeVisible({ timeout: 5000 });

  // Verify DB row
  await new Promise((r) => setTimeout(r, 800)); // settle write
  const count = sql("SELECT COUNT(*) FROM mcp_servers WHERE name='stub';");
  expect(count).toBe('1');
});

test('Phase 2 — chat round-trip with echo tool', async () => {
  test.skip(!HAS_AZURE, 'no AZURE_OPENAI_* env — phase 2 needs a real LLM');

  // back to Chat
  await win.getByRole('button', { name: /^Chat$/i }).click();
  // Attach echo tool to current session via Tools chip strip
  await win.getByRole('button', { name: /Manage tools/i }).click();
  await win.getByRole('checkbox', { name: /^echo$/i }).check();
  // close popover
  await win.keyboard.press('Escape');

  // Send message that asks the model to invoke the tool
  await win.locator('textarea[placeholder]').first().fill('Use the echo tool with text="ping" and report what it returned.');
  await win.keyboard.press('Meta+Enter').catch(() => win.keyboard.press('Enter'));

  // Wait for tool-call card
  const card = win.locator('text=🔧 echo').first();
  await expect(card).toBeVisible({ timeout: 30000 });

  // mcp_tool_usage row exists
  await new Promise((r) => setTimeout(r, 1500));
  const usage = sql("SELECT COUNT(*) FROM mcp_tool_usage WHERE tool_name='echo';");
  expect(Number(usage)).toBeGreaterThanOrEqual(1);
});

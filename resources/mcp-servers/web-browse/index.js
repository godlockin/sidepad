#!/usr/bin/env node
// Bundled web-browse MCP server for sidepad.
// Wraps a headless Playwright Chromium browser as a stdio MCP. Each
// `sessionId` gets its own isolated browser context (cookies, storage). The
// underlying Browser instance is shared and lazy-initialized on first use.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_MARKDOWN_CHARS = 16000;
const MAX_EXTRACT_CHARS = 16000;
const NAV_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const IDLE_SWEEP_MS = 60 * 1000;

const userData = process.env.SIDEPAD_USER_DATA;
if (!userData) {
  process.stderr.write(
    'sidepad-web-browse: SIDEPAD_USER_DATA env var is required\n',
  );
  process.exit(1);
}

const screenshotDir = path.join(userData, 'browser-screenshots');
try {
  fs.mkdirSync(screenshotDir, { recursive: true });
} catch (err) {
  process.stderr.write(
    `sidepad-web-browse: failed to create screenshot dir ${screenshotDir}: ${String(err)}\n`,
  );
  process.exit(1);
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

/** @type {import('playwright').Browser | null} */
let sharedBrowser = null;
/** @type {Map<string, {context: import('playwright').BrowserContext, page: import('playwright').Page, lastUsed: number}>} */
const sessions = new Map();

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

async function getSession(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  const key = String(sessionId);
  let s = sessions.get(key);
  if (s) {
    s.lastUsed = Date.now();
    return s;
  }
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  s = { context, page, lastUsed: Date.now() };
  sessions.set(key, s);
  return s;
}

async function closeSession(sessionId) {
  const key = String(sessionId);
  const s = sessions.get(key);
  if (!s) return false;
  sessions.delete(key);
  try {
    await s.context.close();
  } catch {
    /* ignore */
  }
  return true;
}

// Idle sweeper.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
      s.context.close().catch(() => {});
    }
  }
}, IDLE_SWEEP_MS);
sweepTimer.unref?.();

function htmlToMarkdown(html, baseUrl) {
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.content) {
      return { md: turndown.turndown(article.content), title: article.title || '' };
    }
  } catch {
    /* fallthrough */
  }
  return { md: turndown.turndown(html), title: '' };
}

async function browserOpen({ url, sessionId }) {
  if (!url) throw new Error('url is required');
  const s = await getSession(sessionId);
  await s.page.goto(String(url), { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
  try {
    await s.page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS });
  } catch {
    /* exceeded — proceed with whatever we've got */
  }
  const html = await s.page.content();
  const finalUrl = s.page.url();
  const { md, title: extractedTitle } = htmlToMarkdown(html, finalUrl);
  const pageTitle = (await s.page.title().catch(() => '')) || extractedTitle;
  const truncated = md.length > MAX_MARKDOWN_CHARS;
  const markdown = truncated ? md.slice(0, MAX_MARKDOWN_CHARS) : md;

  const screenshotId = randomUUID();
  const shotPath = path.join(screenshotDir, `${screenshotId}.png`);
  try {
    await s.page.screenshot({ path: shotPath, fullPage: false });
  } catch {
    /* screenshot failure is non-fatal */
  }
  s.lastUsed = Date.now();
  return { title: pageTitle, markdown, truncated, screenshotId, finalUrl };
}

async function browserClick({ selector, sessionId }) {
  if (!selector) throw new Error('selector is required');
  const s = await getSession(sessionId);
  await s.page.locator(String(selector)).first().click({ timeout: NAV_TIMEOUT_MS });
  await s.page.waitForTimeout(2000);
  s.lastUsed = Date.now();
  return { ok: true, newUrl: s.page.url() };
}

async function browserType({ selector, text, sessionId, submit }) {
  if (!selector) throw new Error('selector is required');
  if (text === undefined || text === null) throw new Error('text is required');
  const s = await getSession(sessionId);
  const loc = s.page.locator(String(selector)).first();
  await loc.fill(String(text), { timeout: NAV_TIMEOUT_MS });
  if (submit) {
    await loc.press('Enter');
    try {
      await s.page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT_MS });
    } catch { /* ignore */ }
  }
  s.lastUsed = Date.now();
  return { ok: true, newUrl: s.page.url() };
}

async function browserExtract({ selector, sessionId }) {
  const s = await getSession(sessionId);
  let text;
  if (selector) {
    text = await s.page.$eval(String(selector), (el) => /** @type {HTMLElement} */ (el).innerText);
  } else {
    text = await s.page.evaluate(() => document.body?.innerText ?? '');
  }
  const truncated = text.length > MAX_EXTRACT_CHARS;
  if (truncated) text = text.slice(0, MAX_EXTRACT_CHARS);
  s.lastUsed = Date.now();
  return { text, truncated, url: s.page.url() };
}

async function browserScreenshot({ sessionId, fullPage }) {
  const s = await getSession(sessionId);
  const screenshotId = randomUUID();
  const shotPath = path.join(screenshotDir, `${screenshotId}.png`);
  await s.page.screenshot({ path: shotPath, fullPage: !!fullPage });
  s.lastUsed = Date.now();
  return { screenshotId, path: shotPath };
}

async function browserClose({ sessionId }) {
  const closed = await closeSession(sessionId);
  return { ok: closed };
}

const server = new Server(
  { name: 'sidepad-web-browse', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'browser_open',
      description:
        'Open (or reuse) a per-session headless Chromium and navigate to a URL. Returns the page title, readable markdown (capped at 16000 chars), a screenshot id, and the resolved final URL.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to load.' },
          sessionId: { type: 'string', description: 'Logical session id; isolates cookies/storage.' },
        },
        required: ['url', 'sessionId'],
      },
    },
    {
      name: 'browser_click',
      description: 'Click the first element matching a selector in the session page.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          sessionId: { type: 'string' },
        },
        required: ['selector', 'sessionId'],
      },
    },
    {
      name: 'browser_type',
      description: 'Fill text into the first element matching a selector. Optionally press Enter to submit.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
          sessionId: { type: 'string' },
          submit: { type: 'boolean' },
        },
        required: ['selector', 'text', 'sessionId'],
      },
    },
    {
      name: 'browser_extract',
      description: 'Extract visible text from the page. With a selector, returns innerText of the first match; without, the full body innerText (capped at 16000 chars).',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          sessionId: { type: 'string' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Capture a PNG screenshot of the current session page. Returns its id and path.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          fullPage: { type: 'boolean' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'browser_close',
      description: 'Close a session\'s browser context and free its resources.',
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  let payload;
  switch (req.params.name) {
    case 'browser_open':
      payload = await browserOpen(args);
      break;
    case 'browser_click':
      payload = await browserClick(args);
      break;
    case 'browser_type':
      payload = await browserType(args);
      break;
    case 'browser_extract':
      payload = await browserExtract(args);
      break;
    case 'browser_screenshot':
      payload = await browserScreenshot(args);
      break;
    case 'browser_close':
      payload = await browserClose(args);
      break;
    default:
      throw new Error(`unknown tool: ${req.params.name}`);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
});

async function shutdown() {
  clearInterval(sweepTimer);
  for (const [, s] of sessions) {
    try { await s.context.close(); } catch { /* ignore */ }
  }
  sessions.clear();
  if (sharedBrowser) {
    try { await sharedBrowser.close(); } catch { /* ignore */ }
    sharedBrowser = null;
  }
}
process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

const transport = new StdioServerTransport();
await server.connect(transport);

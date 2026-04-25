#!/usr/bin/env node
// Bundled web-crawl MCP server for sidepad.
// Exposes a single tool `crawl_site` that BFS-crawls a website starting at a
// root URL, restricted to the same host, respects robots.txt (User-agent: *),
// and returns extracted markdown for each visited page.
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
import { createHash } from 'node:crypto';

const MAX_MARKDOWN_CHARS = 8000;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
const STATIC_FETCH_TIMEOUT_MS = 10_000;
const NAV_TIMEOUT_MS = 10_000;
const NETWORKIDLE_BUDGET_MS = 5_000;
const RATE_LIMIT_MS = 500; // 2 req/sec per host
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'sidepad-crawler/0.1';
const JS_HEURISTIC_MARKERS = [
  '__NEXT_DATA__',
  'window.__INITIAL_STATE__',
  'window.__NUXT__',
];

const userData = process.env.SIDEPAD_USER_DATA;
if (!userData) {
  process.stderr.write(
    'sidepad-web-crawl: SIDEPAD_USER_DATA env var is required\n',
  );
  process.exit(1);
}

const cacheDir = path.join(userData, 'web-crawl-cache');
try {
  fs.mkdirSync(cacheDir, { recursive: true });
} catch (err) {
  process.stderr.write(
    `sidepad-web-crawl: failed to create cache dir ${cacheDir}: ${String(err)}\n`,
  );
  process.exit(1);
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/** @type {import('playwright').Browser | null} */
let sharedBrowser = null;
/** @type {import('playwright').BrowserContext | null} */
let sharedContext = null;

async function getBrowserContext() {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
    sharedContext = null;
  }
  if (!sharedContext) {
    sharedContext = await sharedBrowser.newContext({ userAgent: USER_AGENT });
  }
  return sharedContext;
}

async function shutdownBrowser() {
  if (sharedContext) {
    try { await sharedContext.close(); } catch { /* ignore */ }
    sharedContext = null;
  }
  if (sharedBrowser) {
    try { await sharedBrowser.close(); } catch { /* ignore */ }
    sharedBrowser = null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function urlHash(url) {
  return createHash('sha256').update(url).digest('hex');
}

function cachePath(url) {
  return path.join(cacheDir, `${urlHash(url)}.json`);
}

function readCache(url) {
  try {
    const p = cachePath(url);
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const text = fs.readFileSync(p, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeCache(url, value) {
  try {
    fs.writeFileSync(cachePath(url), JSON.stringify(value), 'utf8');
  } catch {
    /* non-fatal */
  }
}

/** Tiny robots.txt parser: returns array of disallowed path prefixes for User-agent: *. */
function parseRobots(text) {
  const lines = String(text).split(/\r?\n/);
  const disallows = [];
  let inStar = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) {
      // blank line ends a record
      inStar = false;
      continue;
    }
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      inStar = value === '*';
    } else if (inStar && key === 'disallow') {
      if (value) disallows.push(value);
    }
  }
  return disallows;
}

async function fetchRobots(rootOrigin) {
  try {
    const res = await fetch(`${rootOrigin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(STATIC_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const text = await res.text();
    return parseRobots(text);
  } catch {
    return [];
  }
}

function isDisallowed(pathname, disallows) {
  for (const d of disallows) {
    if (d && pathname.startsWith(d)) return true;
  }
  return false;
}

function htmlToMarkdown(html, baseUrl) {
  let title = '';
  let mdSource = html;
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    try {
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article && article.content) {
        mdSource = article.content;
        title = article.title || '';
      } else {
        mdSource = dom.window.document.body?.innerHTML ?? html;
      }
    } catch {
      mdSource = dom.window.document.body?.innerHTML ?? html;
    }
    if (!title) {
      title = dom.window.document.title || '';
    }
  } catch {
    /* fallthrough */
  }
  let md;
  try {
    md = turndown.turndown(mdSource);
  } catch {
    md = '';
  }
  return { md, title };
}

function extractLinks(html, baseUrl) {
  const links = [];
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const anchors = dom.window.document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      try {
        const u = new URL(href, baseUrl);
        u.hash = '';
        links.push(u.toString());
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return links;
}

function needsJsFallback(html, useJs) {
  if (useJs) return true;
  if (!html || html.length < 200) return true;
  for (const m of JS_HEURISTIC_MARKERS) {
    if (html.includes(m)) return true;
  }
  return false;
}

async function staticFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(STATIC_FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const ctype = res.headers.get('content-type') || '';
  if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) {
    throw new Error(`unsupported content-type: ${ctype}`);
  }
  // Bound body size by reading as stream.
  const reader = res.body?.getReader();
  if (!reader) {
    return await res.text();
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let total = 0;
  let out = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

async function jsFetch(url) {
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, {
      timeout: NAV_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });
    try {
      await page.waitForLoadState('networkidle', {
        timeout: NETWORKIDLE_BUDGET_MS,
      });
    } catch {
      /* ignore */
    }
    return await page.content();
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

async function fetchPageHtml(url, useJs) {
  let html = '';
  let usedJs = false;
  try {
    html = await staticFetch(url);
  } catch (err) {
    // Static fetch failed entirely — try JS fallback.
    html = '';
  }
  if (needsJsFallback(html, useJs)) {
    try {
      html = await jsFetch(url);
      usedJs = true;
    } catch (err) {
      if (!html) throw err;
    }
  }
  return { html, usedJs };
}

function compileRegex(src) {
  if (!src) return null;
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

async function crawlSite(args) {
  const rootUrlRaw = args.rootUrl;
  if (!rootUrlRaw) throw new Error('rootUrl is required');
  const maxDepth = Math.max(0, Number(args.maxDepth ?? 2));
  const maxPages = Math.max(1, Number(args.maxPages ?? 20));
  const useJs = !!args.useJs;
  const includeRe = compileRegex(args.includePattern);
  const excludeRe = compileRegex(args.excludePattern);

  let rootUrl;
  try {
    rootUrl = new URL(rootUrlRaw);
  } catch {
    throw new Error(`invalid rootUrl: ${rootUrlRaw}`);
  }
  const rootHost = rootUrl.host;
  const rootOrigin = rootUrl.origin;

  const disallows = await fetchRobots(rootOrigin);

  const visited = new Set();
  const queue = [{ url: rootUrl.toString(), depth: 0 }];
  visited.add(rootUrl.toString());

  const pages = [];
  const errors = [];
  let skippedRobots = 0;
  let lastFetchAt = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift();

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.host !== rootHost) continue;

    const pn = parsed.pathname || '/';
    if (isDisallowed(pn, disallows)) {
      skippedRobots += 1;
      continue;
    }
    if (includeRe && !includeRe.test(pn)) continue;
    if (excludeRe && excludeRe.test(pn)) continue;

    // Cache check
    const cached = readCache(url);
    let pageRecord = null;
    if (cached && cached.markdown !== undefined) {
      pageRecord = {
        url,
        title: cached.title || '',
        markdown: cached.markdown,
        depth,
        ...(cached.truncated ? { truncated: true } : {}),
        ...(cached.fromCache ? {} : { fromCache: true }),
        fromCache: true,
      };
    } else {
      // Rate limit (per-domain; we only crawl one domain anyway)
      const elapsed = Date.now() - lastFetchAt;
      if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
      lastFetchAt = Date.now();

      try {
        const { html } = await fetchPageHtml(url, useJs);
        const { md, title } = htmlToMarkdown(html, url);
        const truncated = md.length > MAX_MARKDOWN_CHARS;
        const markdown = truncated ? md.slice(0, MAX_MARKDOWN_CHARS) : md;
        pageRecord = {
          url,
          title,
          markdown,
          depth,
          ...(truncated ? { truncated: true } : {}),
        };
        writeCache(url, { title, markdown, truncated });

        // Discover links from this page (use the original html, not truncated md).
        if (depth < maxDepth && pages.length + 1 < maxPages) {
          const links = extractLinks(html, url);
          for (const link of links) {
            if (visited.has(link)) continue;
            try {
              const lu = new URL(link);
              if (lu.host !== rootHost) continue;
              if (lu.protocol !== 'http:' && lu.protocol !== 'https:') continue;
            } catch {
              continue;
            }
            visited.add(link);
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      } catch (err) {
        errors.push({ url, message: String(err?.message || err) });
        continue;
      }
    }

    pages.push(pageRecord);
  }

  return {
    pages,
    visitedCount: pages.length,
    skippedRobots,
    errors,
  };
}

const server = new Server(
  { name: 'sidepad-web-crawl', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'crawl_site',
      description:
        'BFS-crawl a website from a root URL, same-host only, respecting robots.txt. Returns extracted markdown per page (capped at 8000 chars). Optional regex include/exclude patterns and a JS-rendering fallback (Playwright Chromium) for SPA-heavy pages. Cached for 24h.',
      inputSchema: {
        type: 'object',
        properties: {
          rootUrl: { type: 'string', description: 'Root URL to start crawling from.' },
          maxDepth: { type: 'number', description: 'Max BFS depth (default 2).' },
          maxPages: { type: 'number', description: 'Max pages to crawl (default 20).' },
          includePattern: { type: 'string', description: 'Regex applied to URL path; only matching pages are crawled.' },
          excludePattern: { type: 'string', description: 'Regex applied to URL path; matching pages are skipped.' },
          useJs: { type: 'boolean', description: 'Force Playwright JS rendering for every page.' },
        },
        required: ['rootUrl'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  if (req.params.name !== 'crawl_site') {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const payload = await crawlSite(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
});

async function shutdown() {
  await shutdownBrowser();
}
process.on('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });

const transport = new StdioServerTransport();
await server.connect(transport);

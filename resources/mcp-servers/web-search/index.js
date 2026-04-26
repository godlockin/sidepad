#!/usr/bin/env node
// Bundled web-search MCP server for sidepad.
// Exposes a single tool `web_search(query, maxResults?)` that returns a list
// of {title, url, snippet} results plus the backend that served them.
//
// Backend chain (first one with a usable key/response wins):
//   1. Brave Search API   — requires BRAVE_API_KEY
//   2. Tavily Search API  — requires TAVILY_API_KEY
//   3. SearXNG JSON       — free fallback over public instance pool
//   4. DuckDuckGo HTML    — free fallback (rate-limited scrape)
//
// Backends with missing keys are skipped silently. The chosen backend is
// logged to stderr so the host process can surface it for debugging.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

function unwrapDdgRedirect(href) {
  // DuckDuckGo HTML wraps results in /l/?uddg=<encoded>&...
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return href;
  }
}

async function searchBrave(query, max) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return null;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}&count=${max}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
  });
  if (!res.ok) {
    throw new Error(`brave: HTTP ${res.status}`);
  }
  const data = await res.json();
  const items = (data && data.web && data.web.results) || [];
  return items.slice(0, max).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.description ?? ''),
  }));
}

async function searchTavily(query, max) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: max,
      search_depth: 'basic',
    }),
  });
  if (!res.ok) {
    throw new Error(`tavily: HTTP ${res.status}`);
  }
  const data = await res.json();
  const items = (data && data.results) || [];
  return items.slice(0, max).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? ''),
  }));
}

// Public SearXNG instances known to support `?format=json` for the general
// category. Many of these aggressively rate-limit by IP; the runtime tries up
// to 3 random instances per query before giving up and falling through to DDG.
const SEARXNG_INSTANCES = [
  'https://search.brave4u.com',
  'https://searx.be',
  'https://priv.au',
  'https://search.disroot.org',
  'https://baresearch.org',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://opnxng.com',
  'https://search.hbubli.cc',
  'https://search.rhscz.eu',
];

function pickInstances(pool, n) {
  const arr = pool.slice();
  const out = [];
  for (let i = 0; i < n && arr.length > 0; i++) {
    const idx = Math.floor(Math.random() * arr.length);
    out.push(arr.splice(idx, 1)[0]);
  }
  return out;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchSearxng(query, max) {
  const tries = pickInstances(SEARXNG_INSTANCES, 3);
  let lastErr = null;
  for (const instance of tries) {
    const url = `${instance}/search?q=${encodeURIComponent(
      query,
    )}&format=json&categories=general`;
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'sidepad-search/0.1',
          },
        },
        8000,
      );
      process.stderr.write(
        `[web-search] searxng instance=${instance} status=${res.status}\n`,
      );
      if (!res.ok) {
        lastErr = new Error(`searxng ${instance}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const items = (data && data.results) || [];
      if (items.length === 0) {
        lastErr = new Error(`searxng ${instance}: empty results`);
        continue;
      }
      const results = items.slice(0, max).map((r) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        snippet: String(r.content ?? ''),
      }));
      return { results, instance };
    } catch (err) {
      lastErr = err;
      process.stderr.write(
        `[web-search] searxng instance=${instance} failed: ${String(err)}\n`,
      );
    }
  }
  if (lastErr) throw lastErr;
  return { results: [], instance: null };
}

async function searchDuckDuckGo(query, maxResults) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `q=${encodeURIComponent(query)}`,
  });
  const html = await res.text();
  const results = [];
  const resultRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = resultRe.exec(html)) && results.length < maxResults) {
    const href = unwrapDdgRedirect(m[1]);
    const title = stripTags(m[2] || '');
    const snippet = stripTags(m[3] || '');
    if (!title || !href) continue;
    results.push({ title, url: href, snippet });
  }
  return results;
}

async function runSearchChain(query, max) {
  const chain = [
    { name: 'brave', fn: searchBrave },
    { name: 'tavily', fn: searchTavily },
    { name: 'searxng', fn: searchSearxng },
    { name: 'duckduckgo', fn: searchDuckDuckGo },
  ];
  let lastErr = null;
  for (const backend of chain) {
    try {
      const out = await backend.fn(query, max);
      if (out === null) continue; // missing key — skip silently
      // searxng returns {results, instance}; everything else returns array.
      const results = Array.isArray(out) ? out : out.results;
      const tag =
        backend.name === 'searxng' && out.instance
          ? `searxng:${out.instance}`
          : backend.name;
      process.stderr.write(
        `[web-search] backend=${tag} results=${results.length}\n`,
      );
      return { results, backend: tag };
    } catch (err) {
      lastErr = err;
      process.stderr.write(
        `[web-search] backend=${backend.name} failed: ${String(err)}\n`,
      );
    }
  }
  throw new Error(
    `all web-search backends failed${lastErr ? `: ${String(lastErr)}` : ''}`,
  );
}

const server = new Server(
  { name: 'sidepad-web-search', version: '0.2.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'web_search',
      description:
        'Search the web (Brave → Tavily → SearXNG → DuckDuckGo fallback) and return a list of results with title, url, and snippet.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: {
            type: 'number',
            description: 'Max number of results (default 5, max 20)',
          },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'web_search') {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const args = req.params.arguments ?? {};
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('query is required');
  const maxResults = Math.max(
    1,
    Math.min(20, Number(args.maxResults ?? 5) || 5),
  );
  const payload = await runSearchChain(query, maxResults);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

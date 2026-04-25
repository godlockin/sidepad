#!/usr/bin/env node
// Bundled web-search MCP server for sidepad.
// Exposes a single tool `web_search(query, maxResults?)` that scrapes
// DuckDuckGo's HTML endpoint. No external deps beyond the MCP SDK.
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

async function duckDuckGoSearch(query, maxResults) {
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
  // Each result is in <div class="result"> ... title link <a class="result__a" href="...">TITLE</a>
  // ... snippet <a class="result__snippet">...</a>
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

const server = new Server(
  { name: 'sidepad-web-search', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'web_search',
      description:
        'Search the web (via DuckDuckGo HTML) and return a list of results with title, url, and snippet.',
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
  const results = await duckDuckGoSearch(query, maxResults);
  const payload = { results };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

#!/usr/bin/env node
// Bundled knowledge-base MCP server for sidepad.
// Read-only: re-embeds the query and runs naive cosine over kb_chunks.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';

const SNIPPET_RADIUS = 200;

const dbPath = process.env.SIDEPAD_DB_PATH;
if (!dbPath) {
  process.stderr.write('sidepad-kb: SIDEPAD_DB_PATH env var is required\n');
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  process.stderr.write(`sidepad-kb: failed to open db at ${dbPath}: ${String(err)}\n`);
  process.exit(1);
}

function readSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

function getEmbedderConfig() {
  const provider = readSetting('kb_embedder_provider') ?? 'ollama';
  const model = readSetting('kb_embedder_model') ?? 'nomic-embed-text';
  const baseUrl =
    readSetting('kb_embedder_base_url') ??
    (provider === 'openai' ? 'https://api.openai.com' : 'http://localhost:11434');
  const apiKey = readSetting('kb_embedder_api_key');
  return { provider, model, baseUrl, apiKey };
}

async function embedQuery(query) {
  const cfg = getEmbedderConfig();
  if (cfg.provider === 'openai') {
    const url = `${String(cfg.baseUrl).replace(/\/$/, '')}/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: [query] }),
    });
    if (!res.ok) throw new Error(`openai embeddings failed: ${res.status}`);
    const json = await res.json();
    return Float32Array.from(json.data[0].embedding);
  }
  const res = await fetch(
    `${String(cfg.baseUrl).replace(/\/$/, '')}/api/embeddings`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, prompt: query }),
    },
  );
  if (!res.ok) throw new Error(`ollama embeddings failed: ${res.status}`);
  const json = await res.json();
  return Float32Array.from(json.embedding);
}

function deserializeEmbedding(buf) {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function kbSearch(query, k, tags) {
  if (!query) throw new Error('query is required');
  const limit = Number.isFinite(k) && k > 0 ? Math.min(50, Number(k)) : 5;
  const qVec = await embedQuery(String(query));
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.document_id, c.text, c.embedding,
              d.filename, d.tags
       FROM kb_chunks c
       JOIN kb_documents d ON d.id = c.document_id
       WHERE d.status = 'ready' AND c.embedding IS NOT NULL`,
    )
    .all();

  const wantTags = Array.isArray(tags) && tags.length ? tags : null;
  const scored = [];
  for (const r of rows) {
    if (wantTags) {
      let docTags = [];
      try { docTags = r.tags ? JSON.parse(r.tags) : []; } catch {}
      if (!wantTags.some((t) => docTags.includes(t))) continue;
    }
    const v = deserializeEmbedding(r.embedding);
    const s = cosine(qVec, v);
    scored.push({
      documentId: r.document_id,
      chunkId: r.chunk_id,
      text: r.text,
      score: s,
      filename: r.filename,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((h) => {
    const t = h.text || '';
    const snippet = t.length > 2 * SNIPPET_RADIUS
      ? t.slice(0, SNIPPET_RADIUS) + '…'
      : t;
    return { ...h, snippet };
  });
}

function kbList() {
  return db
    .prepare(
      `SELECT id, source_type, source_path, filename, mime, size_bytes,
              tags, status, chunk_count, token_count, created_at, updated_at
       FROM kb_documents ORDER BY updated_at DESC`,
    )
    .all();
}

const server = new Server(
  { name: 'sidepad-kb', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'kb_search',
      description:
        'Semantic search across the local knowledge base. Returns top-k chunks ranked by cosine similarity. Each result has documentId, chunkId, filename, score, text, and a short snippet.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          k: { type: 'number', description: 'Top K results (default 5, max 50)' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional document-tag filter (any-match).',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'kb_list',
      description: 'List all indexed documents in the knowledge base.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  let payload;
  switch (req.params.name) {
    case 'kb_search':
      payload = { results: await kbSearch(args.query, args.k, args.tags) };
      break;
    case 'kb_list':
      payload = { documents: kbList() };
      break;
    default:
      throw new Error(`unknown tool: ${req.params.name}`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

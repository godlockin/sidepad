#!/usr/bin/env node
// Bundled parse-document MCP server for sidepad.
// Exposes 3 tools that read attachments from sidepad's SQLite db so the LLM
// can pull large parsed documents on demand instead of inlining everything.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';

const MAX_READ_CHARS = 32000;
const SNIPPET_RADIUS = 200;

const dbPath = process.env.SIDEPAD_DB_PATH;
if (!dbPath) {
  process.stderr.write(
    'sidepad-parse-document: SIDEPAD_DB_PATH env var is required\n',
  );
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  process.stderr.write(
    `sidepad-parse-document: failed to open db at ${dbPath}: ${String(err)}\n`,
  );
  process.exit(1);
}

function listAttachments(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');
  const rows = db
    .prepare(
      `SELECT id, filename, mime, size_bytes, token_estimate, parse_status
       FROM attachments WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .all(String(sessionId));
  return rows;
}

function readAttachment(id, range) {
  if (!id) throw new Error('id is required');
  const row = db
    .prepare(
      `SELECT id, filename, mime, parsed_markdown, parse_status, token_estimate
       FROM attachments WHERE id = ?`,
    )
    .get(String(id));
  if (!row) throw new Error(`attachment not found: ${id}`);
  const md = row.parsed_markdown ?? '';
  let start = 0;
  let end = md.length;
  if (range && typeof range === 'object') {
    if (Number.isFinite(range.startChar)) start = Math.max(0, Number(range.startChar));
    if (Number.isFinite(range.endChar)) end = Math.max(start, Number(range.endChar));
  }
  end = Math.min(end, start + MAX_READ_CHARS, md.length);
  const truncated = end < md.length || start > 0;
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    parse_status: row.parse_status,
    token_estimate: row.token_estimate,
    totalChars: md.length,
    startChar: start,
    endChar: end,
    truncated,
    content: md.slice(start, end),
  };
}

function searchAttachments(sessionId, query) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!query) throw new Error('query is required');
  const q = String(query);
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = db
    .prepare(
      `SELECT id, filename, parsed_markdown
       FROM attachments
       WHERE session_id = ? AND parsed_markdown IS NOT NULL
         AND parsed_markdown LIKE ? ESCAPE '\\'`,
    )
    .all(String(sessionId), like);
  const needle = q.toLowerCase();
  const results = [];
  for (const r of rows) {
    const md = r.parsed_markdown ?? '';
    const lower = md.toLowerCase();
    let matchCount = 0;
    let idx = 0;
    let firstIdx = -1;
    while (true) {
      const i = lower.indexOf(needle, idx);
      if (i === -1) break;
      if (firstIdx === -1) firstIdx = i;
      matchCount++;
      idx = i + needle.length;
      if (matchCount > 1000) break;
    }
    if (matchCount === 0 || firstIdx === -1) continue;
    const sStart = Math.max(0, firstIdx - SNIPPET_RADIUS);
    const sEnd = Math.min(md.length, firstIdx + needle.length + SNIPPET_RADIUS);
    const snippet =
      (sStart > 0 ? '…' : '') +
      md.slice(sStart, sEnd) +
      (sEnd < md.length ? '…' : '');
    results.push({
      id: r.id,
      filename: r.filename,
      snippet,
      matchCount,
    });
  }
  return results;
}

const server = new Server(
  { name: 'sidepad-parse-document', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_attachments',
      description:
        'List attachments uploaded to a sidepad chat session. Returns id, filename, mime, size_bytes, token_estimate, parse_status.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'sidepad chat session id' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'read_attachment',
      description:
        'Read parsed markdown for a single attachment by id. Optionally pass a character range. Capped at 32000 chars per call.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'attachment id' },
          range: {
            type: 'object',
            description: 'Optional char range to slice',
            properties: {
              startChar: { type: 'number' },
              endChar: { type: 'number' },
            },
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'search_attachments',
      description:
        'Case-insensitive substring search across all parsed_markdown fields in a session. Returns id, filename, snippet (±200 chars around first match), matchCount.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['sessionId', 'query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  let payload;
  switch (req.params.name) {
    case 'list_attachments':
      payload = { attachments: listAttachments(args.sessionId) };
      break;
    case 'read_attachment':
      payload = readAttachment(args.id, args.range);
      break;
    case 'search_attachments':
      payload = {
        results: searchAttachments(args.sessionId, args.query),
      };
      break;
    default:
      throw new Error(`unknown tool: ${req.params.name}`);
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

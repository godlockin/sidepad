# P3 — Skills + MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Model Context Protocol (MCP) servers and a Skills library into sidepad so any chat session can attach external tools and reusable system-prompt addenda, exposing them through Settings UI and rendering tool-call traffic inline in the chat surface.

**Architecture:**
- **Backend** — A new `mcp` subsystem in `src/main/mcp/` manages MCP client connections (stdio + http + sse) using `@modelcontextprotocol/sdk`. A new `skills` subsystem in `src/main/skills/` loads markdown-with-frontmatter skill files from disk + DB. Two new tRPC routers (`mcp-router.ts`, `skills-router.ts`) expose CRUD + actions. The `LLMProvider` interface gains an optional `tools` parameter and emits `toolCall` chunks; the orchestrator wraps each runner in a tool-resolution loop that invokes MCP tools, persists usage, and re-feeds results into the next provider call.
- **Frontend** — Two new Settings tabs (`MCPTab.tsx`, `SkillsTab.tsx`). ChatPage gets a per-session "active tools" chip strip + a skill multi-select. `MessageBubble` renders `tool_call` segments as collapsible cards.
- **Persistence** — Activate placeholder migrations 002/003 by adding indexes + a new `session_tools` join table in migration 017. Persist every tool invocation to `mcp_tool_usage` for auditability.

**Tech Stack:**
- `@modelcontextprotocol/sdk` (TypeScript) — MCP client transports + types
- `gray-matter` — parse YAML frontmatter from skill markdown files
- Existing: tRPC 10, Zustand, better-sqlite3, Zod, Playwright `_electron`

---

## Critical Files (current state)

- `src/main/store/migrations/002_mcp_placeholder.sql` — defines `mcp_servers`, `mcp_tool_usage` (placeholder)
- `src/main/store/migrations/003_skills_placeholder.sql` — defines `skills` (placeholder)
- `src/main/orchestrator/types.ts` — current event union (no tool events)
- `src/main/orchestrator/index.ts` — 3 runners (`runParallel`, `runLeadAndComment`, `runRelayInternal`)
- `src/main/providers/types.ts` — `LLMProvider`, `ChatRequest`, `ChatChunk` (no tool fields)
- `src/main/providers/{openai,openai-compat,anthropic,ollama}.ts` — provider impls (no tool support)
- `src/main/ipc/trpc.ts` — router registry (currently: ping/spike/system/session/chat/provider/classifier/secret/persona)
- `src/renderer/pages/SettingsPage.tsx` — settings shell with tab list
- `src/renderer/pages/ChatPage.tsx` — chat surface
- `src/renderer/components/MessageBubble.tsx` — renders message body
- `src/renderer/i18n/{en,zh}.json` — UI strings (will gain `mcp.*` and `skills.*` namespaces)

E2E tests to keep green: `tests/e2e/{boot,group-chat,multi-instance,persona-ui,onboarding,azure-smoke}.e2e.test.ts`.

---

## Phase Layout

P3 ships in **5 sub-phases**, each individually shippable:

- **P3.A** — Schema activation (DB only, no UI)
- **P3.B** — MCP server registry + Settings UI (no chat integration yet)
- **P3.C** — Skills library + Settings UI + ChatPage skill multi-select (composes into system prompt — still no tool calls)
- **P3.D** — Provider tool-calling + Orchestrator loop (the hard part)
- **P3.E** — Tool-call UI in chat + per-session tool selector + e2e

---

# P3.A — Schema activation

**Goal:** Add indexes to the placeholder tables and create `session_tools` for per-session tool/skill selection. Verify migrations apply cleanly to a fresh DB.

### Task A.1 — Add indexes + session_tools migration

**Files:**
- Create: `src/main/store/migrations/017_mcp_skills_indexes.sql`
- Create: `src/main/store/migrations/018_session_tools.sql`
- Test: `tests/integration/migrations.test.ts` (extend existing if present, else create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/migrations.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/main/store/migrations';

describe('migrations 017 + 018', () => {
  it('creates indexes on mcp_servers, mcp_tool_usage, skills', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const names = idx.map((r) => r.name);
    expect(names).toContain('idx_mcp_tool_usage_message');
    expect(names).toContain('idx_mcp_tool_usage_server');
    expect(names).toContain('idx_skills_enabled');
  });

  it('creates session_tools join with composite PK', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(session_tools)").all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ['session_id', 'kind', 'ref_id', 'created_at'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/integration/migrations.test.ts`
Expected: FAIL — indexes/table not present.

- [ ] **Step 3: Write 017_mcp_skills_indexes.sql**

```sql
-- src/main/store/migrations/017_mcp_skills_indexes.sql
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_message ON mcp_tool_usage(message_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_server  ON mcp_tool_usage(server_id);
CREATE INDEX IF NOT EXISTS idx_skills_enabled         ON skills(enabled);
```

- [ ] **Step 4: Write 018_session_tools.sql**

```sql
-- src/main/store/migrations/018_session_tools.sql
CREATE TABLE IF NOT EXISTS session_tools (
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK(kind IN ('mcp_tool','skill')),
  ref_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_session_tools_session ON session_tools(session_id);
```

- [ ] **Step 5: Re-run test → PASS**

Run: `rtk proxy npx vitest run tests/integration/migrations.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/main/store/migrations/017_mcp_skills_indexes.sql \
        src/main/store/migrations/018_session_tools.sql \
        tests/integration/migrations.test.ts
git commit -m "feat(db): activate MCP/skills indexes + session_tools join"
```

---

# P3.B — MCP server registry + Settings UI

**Goal:** Users can add/remove/enable MCP servers from Settings; backend connects to them via `@modelcontextprotocol/sdk` and lists their tools. No chat integration yet.

### Task B.1 — Install MCP SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1**: `rtk proxy npm install @modelcontextprotocol/sdk gray-matter`
- [ ] **Step 2**: Verify install: `rtk proxy npm ls @modelcontextprotocol/sdk` → shows version, no peer warnings.
- [ ] **Step 3**: Commit

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @modelcontextprotocol/sdk + gray-matter"
```

### Task B.2 — MCP store (CRUD over `mcp_servers`)

**Files:**
- Create: `src/main/store/mcp-store.ts`
- Test: `tests/integration/mcp-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/main/store/migrations';
import { createMCPStore } from '../../src/main/store/mcp-store';

it('CRUD on mcp_servers', () => {
  const db = new Database(':memory:'); runMigrations(db);
  const store = createMCPStore(db);
  const id = store.create({ name: 'fs', transport: 'stdio', config: { command: 'npx', args: ['-y','@mcp/server-fs'] }, enabled: true });
  expect(store.list()).toHaveLength(1);
  store.setEnabled(id, false);
  expect(store.list()[0].enabled).toBe(false);
  store.remove(id);
  expect(store.list()).toHaveLength(0);
});
```

- [ ] **Step 2**: Run → FAIL (module missing).

- [ ] **Step 3: Implement** `src/main/store/mcp-store.ts`

```ts
import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type MCPTransport = 'stdio' | 'http' | 'sse';

export interface MCPServerRecord {
  id: string;
  name: string;
  transport: MCPTransport;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
}

export interface MCPStore {
  list(): MCPServerRecord[];
  get(id: string): MCPServerRecord | undefined;
  create(input: { name: string; transport: MCPTransport; config: Record<string, unknown>; enabled?: boolean }): string;
  update(id: string, patch: Partial<Pick<MCPServerRecord, 'name' | 'config' | 'transport'>>): void;
  setEnabled(id: string, enabled: boolean): void;
  remove(id: string): void;
}

export function createMCPStore(db: Database): MCPStore {
  return {
    list() {
      const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all() as any[];
      return rows.map(rowToRecord);
    },
    get(id) {
      const r = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as any;
      return r ? rowToRecord(r) : undefined;
    },
    create({ name, transport, config, enabled = false }) {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO mcp_servers (id,name,transport,config_json,enabled,created_at) VALUES (?,?,?,?,?,?)',
      ).run(id, name, transport, JSON.stringify(config), enabled ? 1 : 0, Date.now());
      return id;
    },
    update(id, patch) {
      const cur = this.get(id);
      if (!cur) throw new Error(`mcp server ${id} not found`);
      const next = { ...cur, ...patch };
      db.prepare('UPDATE mcp_servers SET name=?, transport=?, config_json=? WHERE id=?').run(
        next.name, next.transport, JSON.stringify(next.config), id,
      );
    },
    setEnabled(id, enabled) {
      db.prepare('UPDATE mcp_servers SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
    },
    remove(id) {
      db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id);
    },
  };
}

function rowToRecord(r: any): MCPServerRecord {
  return {
    id: r.id, name: r.name, transport: r.transport,
    config: r.config_json ? JSON.parse(r.config_json) : {},
    enabled: !!r.enabled, createdAt: r.created_at,
  };
}
```

- [ ] **Step 4**: Re-run → PASS.
- [ ] **Step 5**: Commit `feat(store): MCP server CRUD store`.

### Task B.3 — MCP registry (live connections)

**Files:**
- Create: `src/main/mcp/registry.ts`
- Create: `src/main/mcp/types.ts`
- Test: `tests/integration/mcp-registry.test.ts` (uses a stub stdio MCP server in `tests/fixtures/mcp-stub.mjs`)

- [ ] **Step 1: Create stub MCP server fixture**

```js
// tests/fixtures/mcp-stub.mjs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'stub', version: '0.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'echo', description: 'echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: 'text', text: `echo:${req.params.arguments?.text ?? ''}` }],
}));
await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Write failing test**

```ts
import { createMCPRegistry } from '../../src/main/mcp/registry';
import path from 'node:path';

it('connects to stub server, lists tools, calls echo', async () => {
  const reg = createMCPRegistry();
  await reg.connect({ id: 's1', name: 'stub', transport: 'stdio',
    config: { command: 'node', args: [path.resolve('tests/fixtures/mcp-stub.mjs')] }, enabled: true, createdAt: 0 });
  const tools = await reg.listTools('s1');
  expect(tools.map(t => t.name)).toContain('echo');
  const result = await reg.callTool('s1', 'echo', { text: 'hi' });
  expect(JSON.stringify(result)).toContain('echo:hi');
  await reg.disconnect('s1');
});
```

- [ ] **Step 3: Implement** `src/main/mcp/types.ts`

```ts
export interface MCPToolDescriptor {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: unknown; // JSON schema
}
export interface MCPCallResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}
```

- [ ] **Step 4: Implement** `src/main/mcp/registry.ts`

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPServerRecord } from '../store/mcp-store';
import type { MCPToolDescriptor, MCPCallResult } from './types';

export interface MCPRegistry {
  connect(rec: MCPServerRecord): Promise<void>;
  disconnect(id: string): Promise<void>;
  listTools(id: string): Promise<MCPToolDescriptor[]>;
  callTool(id: string, name: string, args: Record<string, unknown>): Promise<MCPCallResult>;
  listAllTools(): Promise<MCPToolDescriptor[]>;
  isConnected(id: string): boolean;
}

interface Conn { client: Client; close: () => Promise<void>; }

export function createMCPRegistry(): MCPRegistry {
  const conns = new Map<string, Conn>();

  async function buildTransport(rec: MCPServerRecord) {
    if (rec.transport === 'stdio') {
      const cfg = rec.config as { command: string; args?: string[]; env?: Record<string, string> };
      return new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env });
    }
    if (rec.transport === 'http') {
      const cfg = rec.config as { url: string; headers?: Record<string, string> };
      return new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
    }
    const cfg = rec.config as { url: string };
    return new SSEClientTransport(new URL(cfg.url));
  }

  return {
    async connect(rec) {
      if (conns.has(rec.id)) return;
      const transport = await buildTransport(rec);
      const client = new Client({ name: 'sidepad', version: '0.3.0' }, { capabilities: {} });
      await client.connect(transport);
      conns.set(rec.id, { client, close: () => client.close() });
    },
    async disconnect(id) {
      const c = conns.get(id);
      if (!c) return;
      await c.close();
      conns.delete(id);
    },
    async listTools(id) {
      const c = conns.get(id);
      if (!c) throw new Error(`mcp server ${id} not connected`);
      const res = await c.client.listTools();
      return res.tools.map((t) => ({ serverId: id, name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(id, name, args) {
      const c = conns.get(id);
      if (!c) throw new Error(`mcp server ${id} not connected`);
      const res = await c.client.callTool({ name, arguments: args });
      return res as MCPCallResult;
    },
    async listAllTools() {
      const out: MCPToolDescriptor[] = [];
      for (const id of conns.keys()) {
        try { out.push(...(await this.listTools(id))); } catch { /* skip dead conn */ }
      }
      return out;
    },
    isConnected(id) { return conns.has(id); },
  };
}
```

- [ ] **Step 5**: Run test → PASS.
- [ ] **Step 6**: Commit `feat(mcp): registry with stdio/http/sse transports`.

### Task B.4 — MCP tRPC router

**Files:**
- Create: `src/main/ipc/routers/mcp-router.ts`
- Modify: `src/main/ipc/trpc.ts` (register router)
- Modify: `src/main/index.ts` (instantiate registry, pass into context)

- [ ] **Step 1**: Add registry to main context.

```ts
// src/main/index.ts (excerpt)
import { createMCPRegistry } from './mcp/registry';
const mcpRegistry = createMCPRegistry();
// add to tRPC context creator
```

- [ ] **Step 2**: Write router

```ts
// src/main/ipc/routers/mcp-router.ts
import { z } from 'zod';
import { router, procedure } from '../trpc-base';
import { createMCPStore } from '../../store/mcp-store';

export const mcpRouter = router({
  list: procedure.query(({ ctx }) => createMCPStore(ctx.db).list()),
  add: procedure
    .input(z.object({
      name: z.string().min(1),
      transport: z.enum(['stdio','http','sse']),
      config: z.record(z.unknown()),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = createMCPStore(ctx.db).create(input);
      if (input.enabled) {
        const rec = createMCPStore(ctx.db).get(id)!;
        await ctx.mcp.connect(rec);
      }
      return id;
    }),
  setEnabled: procedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const store = createMCPStore(ctx.db);
      store.setEnabled(input.id, input.enabled);
      const rec = store.get(input.id)!;
      if (input.enabled) await ctx.mcp.connect(rec);
      else await ctx.mcp.disconnect(input.id);
    }),
  remove: procedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.mcp.disconnect(input.id);
    createMCPStore(ctx.db).remove(input.id);
  }),
  listTools: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => ctx.mcp.listTools(input.id)),
  testConnection: procedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const rec = createMCPStore(ctx.db).get(input.id);
    if (!rec) throw new Error('not found');
    if (!ctx.mcp.isConnected(input.id)) await ctx.mcp.connect(rec);
    return ctx.mcp.listTools(input.id);
  }),
});
```

- [ ] **Step 3**: Register in `src/main/ipc/trpc.ts`:

```ts
import { mcpRouter } from './routers/mcp-router';
export const appRouter = router({ /* ...existing, */ mcp: mcpRouter });
```

- [ ] **Step 4**: `rtk proxy npx tsc --noEmit` → 0 new errors.
- [ ] **Step 5**: Commit `feat(ipc): mcp tRPC router (list/add/enable/remove/listTools)`.

### Task B.5 — MCPTab Settings UI

**Files:**
- Create: `src/renderer/pages/settings/MCPTab.tsx`
- Create: `src/renderer/stores/mcp-store.ts` (renderer-side Zustand)
- Modify: `src/renderer/pages/SettingsPage.tsx` (add `'mcp'` tab key)
- Modify: `src/renderer/i18n/en.json` + `zh.json` (add `settings.mcp.*` namespace)

- [ ] **Step 1**: Add i18n keys

```json
// en.json (excerpt)
"settings": {
  "tabs": { "voices": "Voices", "personas": "Personas", "mcp": "Tools", "skills": "Skills", "appearance": "Appearance", "about": "About" },
  "mcp": {
    "title": "MCP Tools",
    "body": "Connect Model Context Protocol servers to give your voices real-world tools.",
    "configured": "Connected",
    "add": "+ Add server",
    "empty": "No MCP servers configured.",
    "transport": "Transport",
    "command": "Command",
    "args": "Args (one per line)",
    "url": "URL",
    "save": "Save server",
    "cancel": "Cancel",
    "test": "Test",
    "remove": "Remove",
    "enable": "Enable",
    "disable": "Disable",
    "toolsLabel": "Tools",
    "toolsLoading": "Loading…"
  }
}
```

(Mirror in `zh.json` with translations; keep button text "Save server" identical for selector stability is **not** required here — these are new strings.)

- [ ] **Step 2**: Renderer store

```ts
// src/renderer/stores/mcp-store.ts
import { create } from 'zustand';
import { trpc } from '../lib/trpc';

export interface MCPServerView { id: string; name: string; transport: 'stdio'|'http'|'sse'; config: any; enabled: boolean; }

interface State {
  servers: MCPServerView[];
  load(): Promise<void>;
  add(input: { name: string; transport: 'stdio'|'http'|'sse'; config: any; enabled?: boolean }): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useMCPStore = create<State>((set, get) => ({
  servers: [],
  async load() { set({ servers: await trpc.mcp.list.query() }); },
  async add(input) { await trpc.mcp.add.mutate(input); await get().load(); },
  async setEnabled(id, enabled) { await trpc.mcp.setEnabled.mutate({ id, enabled }); await get().load(); },
  async remove(id) { await trpc.mcp.remove.mutate({ id }); await get().load(); },
}));
```

- [ ] **Step 3**: Component `MCPTab.tsx` — list view + an "add server" form (transport select; if `stdio`: command + args textarea; if `http`/`sse`: url field). Reuse `Field`, `Input`, `Select`, `Button`, `Heading` primitives. Mirror `PersonasTab.tsx` layout.

- [ ] **Step 4**: Wire into `SettingsPage.tsx` — add `{ key: 'mcp', label: t('settings.tabs.mcp') }` to `TABS`, render `<MCPTab />` when active.

- [ ] **Step 5**: `rtk proxy npm run build` → success. Manual smoke: add the `tests/fixtures/mcp-stub.mjs` server via UI; verify tools list shows `echo`.

- [ ] **Step 6**: Commit `feat(settings): MCP servers tab — connect, list tools, enable/disable`.

---

# P3.C — Skills library + ChatPage skill multi-select

**Goal:** Users can browse/install/edit skills (markdown with YAML frontmatter). A session can attach 1-N skills; their `system_prompt_addendum` composes into the orchestrator system prompt **without** any tool calls yet.

### Task C.1 — Skill loader + store

**Files:**
- Create: `src/main/skills/types.ts`
- Create: `src/main/skills/loader.ts`
- Create: `src/main/store/skill-store.ts`
- Test: `tests/integration/skills-loader.test.ts`

- [ ] **Step 1: Define types**

```ts
// src/main/skills/types.ts
export interface SkillManifest {
  name: string;
  description?: string;
  system_prompt_addendum?: string;
  recommended_tools?: string[]; // free-form names; matched against MCP tools
}
export interface SkillRecord {
  id: string;
  name: string;
  description?: string;
  manifest: SkillManifest;
  body: string;             // markdown body after frontmatter
  source: 'bundled' | 'user';
  enabled: boolean;
  createdAt: number;
}
```

- [ ] **Step 2: Loader**

```ts
// src/main/skills/loader.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import type { SkillManifest, SkillRecord } from './types';

const USER_DIR = path.join(os.homedir(), '.config', 'sidepad', 'skills');
const BUNDLED_DIR = path.join(__dirname, '..', '..', 'resources', 'skills');

export function loadSkillsFromDisk(): SkillRecord[] {
  const out: SkillRecord[] = [];
  for (const [dir, source] of [[BUNDLED_DIR, 'bundled' as const], [USER_DIR, 'user' as const]]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const parsed = matter(raw);
      const manifest = parsed.data as SkillManifest;
      if (!manifest?.name) continue;
      out.push({
        id: `${source}:${file.replace(/\.md$/, '')}`,
        name: manifest.name,
        description: manifest.description,
        manifest,
        body: parsed.content,
        source,
        enabled: false,
        createdAt: Date.now(),
      });
    }
  }
  return out;
}
```

- [ ] **Step 3: Store** (`src/main/store/skill-store.ts`) — same shape as `mcp-store.ts` but for `skills` table; on `init()`, syncs disk-loaded skills into the table (upsert by id).

- [ ] **Step 4**: Test asserts loader picks up a fixture skill `tests/fixtures/skills/researcher.md`:

```md
---
name: Researcher
description: Persona that searches and cites sources
system_prompt_addendum: |
  When answering, search before responding and cite URLs inline.
recommended_tools:
  - web_search
  - fetch_url
---
# Researcher
Use this skill when factual accuracy matters.
```

- [ ] **Step 5**: Commit `feat(skills): markdown+frontmatter loader + DB-backed store`.

### Task C.2 — Skills tRPC router + Settings UI

**Files:**
- Create: `src/main/ipc/routers/skills-router.ts`
- Modify: `src/main/ipc/trpc.ts`
- Create: `src/renderer/pages/settings/SkillsTab.tsx`
- Create: `src/renderer/stores/skill-store.ts`
- Modify: `src/renderer/pages/SettingsPage.tsx`
- Modify: i18n files (`settings.skills.*`)

- [ ] **Step 1**: Router exposes: `list`, `setEnabled`, `create` (user skill from form fields → writes a `.md` to `~/.config/sidepad/skills/`), `update`, `remove` (refuses bundled).
- [ ] **Step 2**: `SkillsTab.tsx` mirrors `PersonasTab.tsx`: list with name + description + enable toggle; "+ New skill" opens a form with `name`, `description`, `system_prompt_addendum`, `recommended_tools` (comma-separated).
- [ ] **Step 3**: `rtk proxy npm run build` → success.
- [ ] **Step 4**: Commit `feat(settings): Skills tab — install, edit, enable/disable`.

### Task C.3 — Per-session skill attachment + system-prompt composition

**Files:**
- Create: `src/main/store/session-tools-store.ts` (CRUD on `session_tools`)
- Modify: `src/main/ipc/routers/session-router.ts` — add `attachSkill`, `detachSkill`, `listAttached`
- Modify: `src/main/orchestrator/index.ts` — when assembling system prompt, append all enabled skills' `system_prompt_addendum` after persona prompt
- Modify: `src/renderer/pages/ChatPage.tsx` — add a "Skills" chip strip in the header (read from `useSkillStore` + session attachments); clicking opens a popover with checkboxes.
- Modify: i18n `chat.skills.*`

- [ ] **Step 1**: Write integration test `tests/integration/orchestrator-skill-prompt.test.ts` that mocks a provider and asserts the assembled system prompt includes the skill addendum text.
- [ ] **Step 2**: Implement, run test → PASS.
- [ ] **Step 3**: Manual smoke: attach the Researcher skill in a session → send a message → confirm the system prompt logged in DEV mode contains the addendum.
- [ ] **Step 4**: Commit `feat(chat): per-session skills compose into system prompt`.

---

# P3.D — Provider tool-calling + Orchestrator loop

**Goal:** Providers accept a `tools` parameter and yield tool-call chunks; the orchestrator loops `provider → tool → provider` until the model emits final content; every tool call is persisted to `mcp_tool_usage`.

### Task D.1 — Extend provider type contract

**Files:**
- Modify: `src/main/providers/types.ts`

- [ ] **Step 1: Add types**

```ts
// src/main/providers/types.ts (additions)
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: unknown; // JSON schema
}
export interface ToolCall {
  id: string;            // provider-issued id, used to correlate result
  name: string;
  arguments: Record<string, unknown>;
}
export interface ChatRequest {
  // ...existing
  tools?: ToolDefinition[];
}
export interface ChatChunk {
  // ...existing
  toolCalls?: ToolCall[]; // emitted on the final chunk for that round
}
// Plus: callers may pass prior assistant message with tool_calls + tool messages with tool_call_id.
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; name?: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string };
```

Update `ChatRequest.messages` to `ChatMessage[]`.

- [ ] **Step 2**: `rtk proxy npx tsc --noEmit` — expect compile errors in providers; this drives the next tasks.
- [ ] **Step 3**: Commit `refactor(providers): extend types with tools + tool-call messages`.

### Task D.2 — OpenAI + OpenAI-compat tool-calling

**Files:**
- Modify: `src/main/providers/openai.ts`
- Modify: `src/main/providers/openai-compat.ts`
- Test: `tests/integration/openai-tools.test.ts` (mock with `nock` or a stubbed OpenAI client)

- [ ] **Step 1: Failing test** — feed a fixture stream that emits `tool_calls` deltas; assert provider yields a `ChatChunk` with `toolCalls`.
- [ ] **Step 2: Implement** — pass `tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }))`; accumulate `delta.tool_calls[].function.arguments` across chunks (OpenAI streams arguments incrementally); emit final assembled `toolCalls` on `finish_reason === 'tool_calls'`.
- [ ] **Step 3**: Translate `role: 'tool'` messages back to OpenAI format `{ role: 'tool', tool_call_id, content }`.
- [ ] **Step 4**: Test → PASS. Commit `feat(providers/openai): tool-calling in streaming chat`.

### Task D.3 — Anthropic tool-use

**Files:**
- Modify: `src/main/providers/anthropic.ts`
- Test: `tests/integration/anthropic-tools.test.ts`

- [ ] **Step 1**: Pass `tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))`.
- [ ] **Step 2**: Handle SSE event types `content_block_start` (with `type: 'tool_use'`), `content_block_delta` (with `input_json_delta`), `content_block_stop`. Reconstruct tool call inputs by streaming JSON fragments.
- [ ] **Step 3**: Translate `role: 'tool'` messages to Anthropic format: a `user` message with content blocks of type `tool_result` keyed by `tool_use_id`.
- [ ] **Step 4**: Test → PASS. Commit.

### Task D.4 — Ollama (gated)

**Files:**
- Modify: `src/main/providers/ollama.ts`

- [ ] **Step 1**: If `req.tools` is present, attempt the `tools` parameter (Ollama 0.3+ supports a subset of models). On `unsupported_model` error, log a warning and fall back to text-only.
- [ ] **Step 2**: Commit `feat(providers/ollama): best-effort tool-calling, gated by model support`.

### Task D.5 — Orchestrator tool loop

**Files:**
- Modify: `src/main/orchestrator/types.ts` — add events:

```ts
| { type: 'tool_call:start'; turnId: string; msgId: string; agentId: string; toolCallId: string; serverId: string; toolName: string; args: Record<string, unknown> }
| { type: 'tool_call:result'; turnId: string; msgId: string; agentId: string; toolCallId: string; result: unknown; isError: boolean; durationMs: number }
```

- Modify: `src/main/orchestrator/index.ts` — wrap each per-agent provider call in a loop:

```
1. Resolve enabled tools for session: union(MCP tools attached to session) ∪ (skill.recommended_tools ∩ available MCP tools).
2. Convert to ToolDefinition[].
3. Call provider with tools. Stream deltas → emit message:delta.
4. On finish chunk:
   - If toolCalls is empty → emit message:finish, exit loop.
   - Else: for each tool call:
       a. Emit tool_call:start.
       b. Lookup serverId by tool name (registry); call mcp.callTool().
       c. Persist row to mcp_tool_usage (message_id, server_id, tool_name, args_json, result_json, error?).
       d. Emit tool_call:result.
   - Append assistant message (with toolCalls) + tool messages (with toolCallId, content = stringified result) to the next request.
   - Loop back to step 3.
5. Loop guard: max 6 rounds per turn → on exceed, emit message:error with code 'tool_loop_exceeded'.
```

- Test: `tests/integration/orchestrator-tool-loop.test.ts` — uses the stub MCP server + a stub provider that emits one tool call then a final message; assert events sequence and a row in `mcp_tool_usage`.

- [ ] **Step 1**: Write failing test.
- [ ] **Step 2**: Implement loop in `runParallel` first; then DRY into a helper used by all three runners.
- [ ] **Step 3**: Test → PASS.
- [ ] **Step 4**: `rtk proxy npx tsc --noEmit` → 0 new errors.
- [ ] **Step 5**: Commit `feat(orchestrator): tool-call loop with persistence + loop guard`.

---

# P3.E — Tool-call UI + per-session tool selector + e2e

**Goal:** Users can pick which MCP tools are enabled per session; tool calls stream into the chat as collapsible cards; an e2e test runs end-to-end against the stub MCP server.

### Task E.1 — Per-session tool selector

**Files:**
- Modify: `src/main/ipc/routers/session-router.ts` — add `attachTool`, `detachTool`, `listAttachedTools`
- Modify: `src/renderer/pages/ChatPage.tsx` — header gains a "Tools" chip strip + popover (mirrors skill selector from C.3)
- Modify: i18n `chat.tools.*`

- [ ] **Step 1**: Implement.
- [ ] **Step 2**: Manual smoke: attach `echo` from stub server to a session.
- [ ] **Step 3**: Commit `feat(chat): per-session MCP tool attachment`.

### Task E.2 — MessageBubble tool-call rendering

**Files:**
- Modify: `src/renderer/components/MessageBubble.tsx`
- Modify: `src/renderer/stores/chat-store.ts` — extend message type with `toolCalls?: Array<{ id: string; name: string; args: any; result?: any; isError?: boolean; durationMs?: number; status: 'pending'|'done'|'error' }>`
- Modify: `src/renderer/lib/event-bridge.ts` — handle `tool_call:start` / `tool_call:result` events, append/update on the current assistant message

- [ ] **Step 1**: Render tool calls as inline cards above the message body:
  ```
  ┌─────────────────────────────────────┐
  │ 🔧 echo  ·  240 ms                  │
  │ args:   { "text": "hi" }            │
  │ result: "echo:hi"                   │
  └─────────────────────────────────────┘
  ```
  Collapsed by default; click to expand args/result. Use `font-mono text-[12px]` for args/result; status pill (`pending` spinner / `done` green / `error` red).
- [ ] **Step 2**: Commit `feat(chat): inline collapsible tool-call cards in MessageBubble`.

### Task E.3 — E2E with stub MCP server

**Files:**
- Create: `tests/e2e/mcp-tools.e2e.test.ts`
- Reuse: `tests/fixtures/mcp-stub.mjs`

- [ ] **Step 1**: Test outline:
  1. Skip if no `OPENAI_API_KEY` / Azure env.
  2. Boot fresh app; complete onboarding with a real provider (reuse helpers).
  3. Open Settings → Tools → add stub server (transport: stdio, command: `node`, args: absolute path to fixture).
  4. Verify `echo` appears in tools list.
  5. Open chat session, attach `echo` tool.
  6. Send: "Use the echo tool with text='ping'."
  7. Assert: a tool-call card appears with name `echo`, args `{text:"ping"}`, result containing `echo:ping`; final assistant message references the result.
  8. Verify a row exists in `mcp_tool_usage` via direct sqlite read.

- [ ] **Step 2**: Run: `rtk proxy npx playwright test tests/e2e/mcp-tools.e2e.test.ts`.
- [ ] **Step 3**: Commit `test(e2e): MCP tool-call round-trip via stub server`.

### Task E.4 — P3 verification + release

- [ ] **Step 1**: `rtk proxy npm run build` → clean.
- [ ] **Step 2**: `rtk proxy npx tsc --noEmit` → 0 new errors.
- [ ] **Step 3**: `rtk proxy npx playwright test` → all green (boot, group-chat, multi-instance, persona-ui, onboarding, mcp-tools; azure-smoke skipped if no env).
- [ ] **Step 4**: Manual smoke matrix:
  - Add an MCP server (stdio + http) in Settings → see tools list.
  - Install a Skill, attach to session → confirm system-prompt addendum applied.
  - Attach a tool to session → ask model to use it → see tool-call card → see final answer using the result.
  - Restart app → MCP servers reconnect on boot; persisted tool-call usage rows survive.
- [ ] **Step 5**: Repackage `dist-app/sidepad-darwin-arm64/sidepad.app`.
- [ ] **Step 6**: Tag `v0.3.0-tools` and push.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| MCP SDK breaking changes between minor versions | Pin exact version in `package.json`; smoke test on upgrade |
| Long-running MCP calls block the event loop | Use AbortSignal threaded through orchestrator; expose per-tool timeout (default 30s) in tool wrapper |
| Tool argument JSON parses fail mid-stream | Defer JSON.parse until full args buffered (already inherent to Anthropic delta handling) |
| Untrusted MCP servers can read filesystem | Document risk; surface a "this server can run code on your machine" warning in MCPTab when transport=stdio |
| Provider-specific tool-call formats drift | Each provider has a focused integration test using captured fixture streams |
| Loop runaway (model keeps calling tools) | 6-round hard cap → emit `message:error` with `tool_loop_exceeded` |

## Out-of-scope (defer to P4)

- Streaming tool results (currently atomic per call)
- Parallel tool calls within one round (process serially in P3)
- MCP **resources** + **prompts** (only tools handled in P3)
- Skill marketplace / remote install
- Per-tool argument approval prompts ("ask before running")

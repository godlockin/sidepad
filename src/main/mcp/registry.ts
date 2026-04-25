import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type Database from 'better-sqlite3';
import type { MCPServerRecord } from '../store/mcp-store.js';
import type { MCPToolDescriptor, MCPCallResult } from './types.js';
import { createAppSettingsStore } from '../store/app-settings-store.js';

export interface MCPRegistry {
  connect(rec: MCPServerRecord): Promise<void>;
  disconnect(id: string): Promise<void>;
  listTools(id: string): Promise<MCPToolDescriptor[]>;
  callTool(
    id: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPCallResult>;
  listAllTools(): Promise<MCPToolDescriptor[]>;
  isConnected(id: string): boolean;
}

interface Conn {
  client: Client;
  close: () => Promise<void>;
}

type Transport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  | SSEClientTransport;

function bundledExtraEnv(id: string): Record<string, string> {
  // Bundled MCP servers (id starts with `bundled-`) get app-settings injected
  // as env vars. This keeps API keys out of mcp_servers.config_json (which is
  // intended for user-edited connection metadata, not secrets).
  if (!id.startsWith('bundled-')) return {};
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) return {};
  try {
    const store = createAppSettingsStore(db);
    const extra: Record<string, string> = {};
    if (id === 'bundled-web-search') {
      const brave = store.getSetting('brave_api_key');
      const tavily = store.getSetting('tavily_api_key');
      if (brave) extra.BRAVE_API_KEY = brave;
      if (tavily) extra.TAVILY_API_KEY = tavily;
    }
    return extra;
  } catch {
    return {};
  }
}

function buildTransport(rec: MCPServerRecord): Transport {
  if (rec.transport === 'stdio') {
    const cfg = rec.config as {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
    const mergedEnv = { ...(cfg.env ?? {}), ...bundledExtraEnv(rec.id) };
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: mergedEnv,
    });
  }
  if (rec.transport === 'http') {
    const cfg = rec.config as { url: string; headers?: Record<string, string> };
    return new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: cfg.headers },
    });
  }
  const cfg = rec.config as { url: string };
  return new SSEClientTransport(new URL(cfg.url));
}

export function createMCPRegistry(): MCPRegistry {
  const conns = new Map<string, Conn>();

  const registry: MCPRegistry = {
    async connect(rec) {
      if (conns.has(rec.id)) return;
      const transport = buildTransport(rec);
      const client = new Client(
        { name: 'sidepad', version: '0.3.0' },
        { capabilities: {} },
      );
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
      return res.tools.map((t) => ({
        serverId: id,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
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
        try {
          out.push(...(await registry.listTools(id)));
        } catch {
          // skip dead connection
        }
      }
      return out;
    },
    isConnected(id) {
      return conns.has(id);
    },
  };
  return registry;
}

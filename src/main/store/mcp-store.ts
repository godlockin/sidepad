import type Database from 'better-sqlite3';
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
  create(input: {
    name: string;
    transport: MCPTransport;
    config: Record<string, unknown>;
    enabled?: boolean;
  }): string;
  update(
    id: string,
    patch: Partial<Pick<MCPServerRecord, 'name' | 'config' | 'transport'>>,
  ): void;
  setEnabled(id: string, enabled: boolean): void;
  remove(id: string): void;
}

interface Row {
  id: string;
  name: string;
  transport: MCPTransport;
  config_json: string | null;
  enabled: number;
  created_at: number;
}

function rowToRecord(r: Row): MCPServerRecord {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    config: r.config_json ? (JSON.parse(r.config_json) as Record<string, unknown>) : {},
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}

export function createMCPStore(db: Database.Database): MCPStore {
  const store: MCPStore = {
    list() {
      const rows = db
        .prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC')
        .all() as Row[];
      return rows.map(rowToRecord);
    },
    get(id) {
      const r = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as
        | Row
        | undefined;
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
      const cur = store.get(id);
      if (!cur) throw new Error(`mcp server ${id} not found`);
      const next = { ...cur, ...patch };
      db.prepare(
        'UPDATE mcp_servers SET name=?, transport=?, config_json=? WHERE id=?',
      ).run(next.name, next.transport, JSON.stringify(next.config), id);
    },
    setEnabled(id, enabled) {
      db.prepare('UPDATE mcp_servers SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
    },
    remove(id) {
      db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id);
    },
  };
  return store;
}

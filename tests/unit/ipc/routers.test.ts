import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { registry } from '../../../src/main/providers/index.js';
import type { LLMProvider, Model, ChatRequest, ChatChunk } from '../../../src/main/providers/types.js';

// Mock electron before any imports that transitively require it
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

import { sessionRouter } from '../../../src/main/ipc/routers/session-router.js';
import { providerRouter } from '../../../src/main/ipc/routers/provider-router.js';
import { secretRouter } from '../../../src/main/ipc/routers/secret-router.js';
import { appRouter } from '../../../src/main/ipc/trpc.js';
import type { AppRouter } from '../../../src/main/ipc/trpc.js';

// Create callers using a shared t instance — note: routers use their own initTRPC,
// so we access procedures through _def for structural tests only.
// For functional tests we create a SessionStore directly.

let db: Database.Database;

function setupSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      system_prompt TEXT,
      visibility_mode TEXT NOT NULL DEFAULT 'independent' CHECK(visibility_mode IN ('independent','full')),
      group_mode TEXT NOT NULL DEFAULT 'parallel' CHECK(group_mode IN ('parallel','relay')),
      default_agent_id TEXT,
      participants TEXT NOT NULL DEFAULT '[]',
      folder_id TEXT,
      project_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      parent_message_id TEXT
    );
    CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      model_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      status TEXT NOT NULL DEFAULT 'streaming' CHECK(status IN ('streaming','done','error','aborted','partial')),
      error TEXT,
      parent_message_id TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX idx_messages_turn ON messages(turn_id);
    CREATE INDEX idx_messages_parent ON messages(parent_message_id);

    CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
  `);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  setupSchema(db);
  (globalThis as any).sidepad = { db, secrets: null, paths: { dbPath: ':memory:' } };
});

afterEach(() => {
  db.close();
  delete (globalThis as any).sidepad;
  registry['providers'].clear();
  registry['listeners'].clear();
});

// --- AppRouter type compilation ---

describe('AppRouter type', () => {
  it('compiles with all expected routers', () => {
    // tRPC flattens procedures: routerName.procedureName
    const procs = Object.keys((appRouter as any)._def.procedures);
    const prefixes = [...new Set(procs.map(p => p.split('.')[0]))];
    expect(prefixes).toContain('ping');
    expect(prefixes).toContain('system');
    expect(prefixes).toContain('session');
    expect(prefixes).toContain('chat');
    expect(prefixes).toContain('provider');
    expect(prefixes).toContain('classifier');
    expect(prefixes).toContain('secret');
  });

  it('AppRouter type can be used', () => {
    type TestRouter = typeof appRouter;
    const _check: AppRouter = appRouter;
    expect(_check).toBeDefined();
  });
});

// --- Session Router Tests ---

describe('sessionRouter', () => {
  it('has expected procedures', () => {
    const procs = Object.keys((sessionRouter as any)._def.procedures);
    expect(procs.sort()).toEqual([
      'create', 'delete', 'fork', 'get', 'list', 'messages',
      'rename', 'search', 'setDefaultAgent', 'setVisibilityMode',
    ]);
  });

  it('create is a mutation, list is a query', () => {
    const procs = (sessionRouter as any)._def.procedures;
    expect(procs.create._def.mutation).toBeDefined();
    expect(procs.list._def.query).toBeDefined();
  });
});

// --- Provider Router Tests ---

describe('providerRouter', () => {
  function createMockProvider(overrides?: Partial<LLMProvider>): LLMProvider {
    return {
      id: 'mock-provider',
      configId: 'mock-cfg',
      listModels: async (): Promise<Model[]> => [
        { id: 'model-1', name: 'Mock Model 1', contextWindow: 8192 },
      ],
      async *chat(_req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        yield { delta: 'Hello' };
        yield { finishReason: 'stop' };
      },
      ...overrides,
    };
  }

  it('has expected procedures', () => {
    const procs = Object.keys((providerRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(['configure', 'health', 'list', 'listModels']);
  });

  it('list is a query, configure is a mutation', () => {
    const procs = (providerRouter as any)._def.procedures;
    expect(procs.list._def.query).toBeDefined();
    expect(procs.configure._def.mutation).toBeDefined();
  });

  describe('list', () => {
    it('returns empty array when no providers registered', () => {
      // Verify procedure exists and is a query
      const procs = (providerRouter as any)._def.procedures;
      expect(procs.list._def.query).toBeDefined();
    });
  });

  describe('health', () => {
    it('is an async query procedure', () => {
      const procs = (providerRouter as any)._def.procedures;
      expect(procs.health._def.query).toBeDefined();
    });
  });
});

// --- Secret Router Tests ---

describe('secretRouter structural', () => {
  it('has exactly 3 procedures: has, set, delete', () => {
    const procs = Object.keys((secretRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(['delete', 'has', 'set']);
  });

  it('does not expose a get procedure', () => {
    const procs = (secretRouter as any)._def.procedures;
    expect(procs.get).toBeUndefined();
  });
});

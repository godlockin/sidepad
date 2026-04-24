// tests/unit/store/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionStore } from '@main/store/session-store';

let db: Database.Database;
let store: SessionStore;

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
  store = new SessionStore(db);
});

afterEach(() => {
  db.close();
});

// ---- Session CRUD ----

describe('createSession', () => {
  it('creates a session with defaults and returns it', () => {
    const s = store.createSession({ title: 'Test session' });
    expect(s.id).toBeDefined();
    expect(s.title).toBe('Test session');
    expect(s.visibilityMode).toBe('independent');
    expect(s.groupMode).toBe('parallel');
    expect(s.createdAt).toBeGreaterThan(0);
    expect(s.updatedAt).toBeGreaterThan(0);
    expect(s.participants).toEqual([]);
  });

  it('creates a session with custom participants', () => {
    const s = store.createSession({ title: 'Multi', participants: ['agent-a', 'agent-b'] });
    expect(s.participants).toEqual(['agent-a', 'agent-b']);
  });
});

describe('getSession', () => {
  it('returns a session by id', () => {
    const created = store.createSession({ title: 'Hello' });
    const fetched = store.getSession(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('Hello');
  });

  it('returns null for nonexistent id', () => {
    expect(store.getSession('nonexistent')).toBeNull();
  });
});

describe('listSessions', () => {
  it('returns sessions sorted by updated_at desc', () => {
    const s1 = store.createSession({ title: 'Old' });
    // Manually set older updated_at so ordering is deterministic
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(1000, s1.id);
    const s2 = store.createSession({ title: 'New' });
    const list = store.listSessions();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(s2.id); // newest first
  });

  it('returns empty array when no sessions', () => {
    expect(store.listSessions()).toEqual([]);
  });
});

describe('setDefaultAgent', () => {
  it('sets the default_agent_id', () => {
    const s = store.createSession({ title: 'test' });
    store.setDefaultAgent(s.id, 'my-agent');
    const updated = store.getSession(s.id)!;
    expect(updated.defaultAgentId).toBe('my-agent');
  });
});

describe('setVisibilityMode', () => {
  it('changes visibility mode', () => {
    const s = store.createSession({ title: 'test' });
    store.setVisibilityMode(s.id, 'full');
    const updated = store.getSession(s.id)!;
    expect(updated.visibilityMode).toBe('full');
  });
});

// ---- Message lifecycle ----

describe('appendUserMessage', () => {
  it('appends a user message to a session', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.appendUserMessage(s.id, 'turn-1', 'Hello world');
    expect(msg.id).toBeDefined();
    expect(msg.sessionId).toBe(s.id);
    expect(msg.turnId).toBe('turn-1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello world');
    expect(msg.status).toBe('done');
  });

  it('can set a parent_message_id', () => {
    const s = store.createSession({ title: 'chat' });
    const parent = store.appendUserMessage(s.id, 'turn-1', 'parent');
    const child = store.appendUserMessage(s.id, 'turn-2', 'child', parent.id);
    expect(child.parentMessageId).toBe(parent.id);
  });
});

describe('startAssistantMessage + appendDelta + finalizeAssistant', () => {
  it('creates a streaming assistant message', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    expect(msg.role).toBe('assistant');
    expect(msg.status).toBe('streaming');
    expect(msg.content).toBe('');
    expect(msg.modelId).toBe('gpt-4');
  });

  it('appends delta updates content', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.appendDelta(msg.id, 'Hello');
    store.appendDelta(msg.id, ' world');
    const updated = store.getMessage(msg.id)!;
    expect(updated.content).toBe('Hello world');
    expect(updated.status).toBe('streaming');
  });

  it('finalizes with meta and usage', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.appendDelta(msg.id, 'Hi there');
    const meta = { agentId: 'agent-x', providerId: 'openai', modelId: 'gpt-4', messages: [{ role: 'user' as const, content: 'hi' }] };
    store.finalizeAssistant(msg.id, meta, 'stop', { promptTokens: 10, completionTokens: 5 });
    const done = store.getMessage(msg.id)!;
    expect(done.status).toBe('done');
    expect(done.content).toBe('Hi there');
    expect(done.promptTokens).toBe(10);
    expect(done.completionTokens).toBe(5);
    expect(done.finishedAt).toBeGreaterThan(0);
  });
});

describe('markError', () => {
  it('marks message as error with details', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.markError(msg.id, 'RATE_LIMIT', 'Too many requests');
    const updated = store.getMessage(msg.id)!;
    expect(updated.status).toBe('error');
    expect(updated.error).toContain('RATE_LIMIT');
    expect(updated.finishedAt).toBeGreaterThan(0);
  });
});

describe('markAborted', () => {
  it('marks message as aborted', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.markAborted(msg.id);
    const updated = store.getMessage(msg.id)!;
    expect(updated.status).toBe('aborted');
    expect(updated.finishedAt).toBeGreaterThan(0);
  });
});

describe('markPartial', () => {
  it('marks message as partial', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.appendDelta(msg.id, 'Partial ');
    const meta = { agentId: 'agent-x', providerId: 'openai', modelId: 'gpt-4', messages: [{ role: 'user' as const, content: 'hi' }] };
    store.markPartial(msg.id, meta, { promptTokens: 5, completionTokens: 3 });
    const updated = store.getMessage(msg.id)!;
    expect(updated.status).toBe('partial');
    expect(updated.content).toBe('Partial ');
  });
});

describe('retry', () => {
  it('returns chat request from meta_json', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    // Simulate a full meta (as would be stored by the orchestrator before calling the provider)
    const fullMeta = { agentId: 'agent-x', providerId: 'openai', modelId: 'gpt-4', messages: [{ role: 'user' as const, content: 'Hello' }] };
    store.markError(msg.id, 'TIMEOUT', 'Connection timed out');
    // Update meta_json with full messages (simulating orchestrator having saved it)
    db.prepare('UPDATE messages SET meta_json = ? WHERE id = ?').run(JSON.stringify(fullMeta), msg.id);
    const result = store.retry(msg.id);
    expect(result.providerId).toBe('openai');
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe('continueAssistant', () => {
  it('returns chat request to continue from partial', () => {
    const s = store.createSession({ title: 'chat' });
    const msg = store.startAssistantMessage(s.id, 'turn-1', 'agent-x', 'openai', 'gpt-4');
    store.appendDelta(msg.id, 'Half ');
    const meta = { agentId: 'agent-x', providerId: 'openai', modelId: 'gpt-4', messages: [{ role: 'user' as const, content: 'hi' }] };
    store.markPartial(msg.id, meta);
    const result = store.continueAssistant(msg.id);
    expect(result.providerId).toBe('openai');
    expect(result.messages).toBeDefined();
    // Should include original messages + the partial assistant response
    expect(result.messages.length).toBeGreaterThan(1);
  });
});

// ---- FTS5 search ----

describe('search', () => {
  it('finds messages by content text', () => {
    const s = store.createSession({ title: 'search-test' });
    store.appendUserMessage(s.id, 't1', 'Hello world');
    store.appendUserMessage(s.id, 't2', 'Goodbye moon');
    const results = store.search('Hello');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((m) => m.content.includes('Hello'))).toBe(true);
  });

  it('does not return messages from other sessions with same text', () => {
    const s1 = store.createSession({ title: 'a' });
    const s2 = store.createSession({ title: 'b' });
    store.appendUserMessage(s1.id, 't1', 'unique-text-alpha');
    store.appendUserMessage(s2.id, 't1', 'unique-text-beta');
    const results = store.search('alpha');
    expect(results.every((m) => m.sessionId === s1.id)).toBe(true);
  });

  it('returns empty when no match', () => {
    const s = store.createSession({ title: 'test' });
    store.appendUserMessage(s.id, 't1', 'nothing special');
    expect(store.search('nonexistent-xyz')).toEqual([]);
  });
});

// ---- Fork session ----

describe('forkSession', () => {
  it('creates a new session with messages up to parent message', () => {
    const s = store.createSession({ title: 'original' });
    const msg1 = store.appendUserMessage(s.id, 't1', 'First message');
    const asst1 = store.startAssistantMessage(s.id, 't1', 'agent-x', 'openai', 'gpt-4');
    store.appendDelta(asst1.id, 'Reply one');
    const meta = { agentId: 'agent-x', providerId: 'openai', modelId: 'gpt-4', messages: [{ role: 'user' as const, content: 'hi' }] };
    store.finalizeAssistant(asst1.id, meta, 'stop');
    const msg2 = store.appendUserMessage(s.id, 't2', 'Second message');

    const forked = store.forkSession(msg1.id);
    expect(forked.id).not.toBe(s.id);
    expect(forked.title).toBe(s.title);
    expect(forked.parentMessageId).toBe(msg1.id);
  });

  it('forked session has messages copied up to the fork point', () => {
    const s = store.createSession({ title: 'original' });
    const msg1 = store.appendUserMessage(s.id, 't1', 'Hello');
    const msg2 = store.appendUserMessage(s.id, 't2', 'World');

    const forked = store.forkSession(msg1.id);
    const forkedMessages = store.listMessages(forked.id);
    expect(forkedMessages.length).toBe(1); // only msg1 copied
    expect(forkedMessages[0].content).toBe('Hello');
  });
});

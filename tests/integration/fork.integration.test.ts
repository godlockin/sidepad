import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock electron before any imports that transitively require it
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

import { SessionStore } from '../../../src/main/store/session-store';
import { sessionRouter } from '../../../src/main/ipc/routers/session-router';

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
});

describe('Edit-Fork end-to-end', () => {
  it('forks a session at a message and copies history correctly', () => {
    const store = new SessionStore(db);

    // 1. Create original session
    const original = store.createSession({ title: 'Original', participants: ['agent-a', 'agent-b'] });
    expect(original.title).toBe('Original');
    expect(original.participants).toEqual(['agent-a', 'agent-b']);

    // 2. Add messages: user -> assistant -> user -> assistant
    const turn1 = 'turn-1';
    const msg1 = store.appendUserMessage(original.id, turn1, 'What is TypeScript?');
    const msg2 = store.startAssistantMessage(original.id, turn1, 'agent-a', 'openai', 'gpt-4o');
    store.appendDelta(msg2.id, 'TypeScript is a typed superset of JavaScript.');
    store.finalizeAssistant(msg2.id, {
      providerId: 'openai',
      modelId: 'gpt-4o',
      agentId: 'agent-a',
      messages: [
        { role: 'user', content: 'What is TypeScript?' },
      ],
    }, 'stop', { promptTokens: 10, completionTokens: 20 });

    const turn2 = 'turn-2';
    const msg3 = store.appendUserMessage(original.id, turn2, 'What about Rust?', msg2.id);
    const msg4 = store.startAssistantMessage(original.id, turn2, 'agent-b', 'anthropic', 'claude-sonnet-4');
    store.appendDelta(msg4.id, 'Rust is a systems programming language.');
    store.finalizeAssistant(msg4.id, {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
      agentId: 'agent-b',
      messages: [
        { role: 'user', content: 'What is TypeScript?' },
        { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
        { role: 'user', content: 'What about Rust?' },
      ],
    }, 'stop', { promptTokens: 30, completionTokens: 40 });

    // 3. Fork at msg2 (end of turn 1) — should only copy msg1 + msg2
    const forked = store.forkSession(msg2.id);
    expect(forked.id).not.toBe(original.id);
    expect(forked.title).toBe(original.title);
    expect(forked.participants).toEqual(original.participants);
    expect(forked.visibilityMode).toBe(original.visibilityMode);
    expect(forked.parentMessageId).toBe(msg2.id);

    // 4. Verify forked session has exactly 2 messages
    const forkedMessages = store.listMessages(forked.id);
    expect(forkedMessages).toHaveLength(2);

    // 5. Verify message content is copied correctly
    expect(forkedMessages[0].content).toBe('What is TypeScript?');
    expect(forkedMessages[0].role).toBe('user');
    expect(forkedMessages[0].sessionId).toBe(forked.id);
    expect(forkedMessages[1].content).toBe('TypeScript is a typed superset of JavaScript.');
    expect(forkedMessages[1].role).toBe('assistant');

    // 6. Verify parent_message_id rewriting in forked messages
    expect(forkedMessages[0].parentMessageId).toBeNull();
    // msg2 has no parent in original (it was the first assistant msg), so null in fork too
    expect(forkedMessages[1].parentMessageId).toBeNull();

    // 7. Verify original session is unchanged
    const originalMessages = store.listMessages(original.id);
    expect(originalMessages).toHaveLength(4);
    expect(originalMessages[2].content).toBe('What about Rust?');

    // 8. Fork at msg4 (end of conversation) — should copy all 4 messages
    const forked2 = store.forkSession(msg4.id);
    const forked2Messages = store.listMessages(forked2.id);
    expect(forked2Messages).toHaveLength(4);
    expect(forked2Messages[0].content).toBe('What is TypeScript?');
    expect(forked2Messages[3].content).toBe('Rust is a systems programming language.');

    // 9. Verify parent_message_id is rewritten for msg3 (which pointed to msg2)
    const forked2Msg3 = forked2Messages[2];
    const forked2Msg1 = forked2Messages[0];
    const forked2Msg2 = forked2Messages[1];
    const forked2Msg4 = forked2Messages[3];
    // User msg in turn2 had parent msg2 -> should map to new msg2 id
    expect(forked2Msg3.parentMessageId).toBe(forked2Msg2.id);
    // Assistant msg in turn2 had no parent -> null
    expect(forked2Msg4.parentMessageId).toBeNull();
  });

  it('fork session produces correct SessionStore state for tRPC router', () => {
    // Verify the exact data flow the tRPC router uses:
    // router calls store.forkSession(parentMessageId) then store.getSession(forked.id)
    const store = new SessionStore(db);
    const original = store.createSession({ title: 'To Fork', participants: ['agent-x'] });
    const msg1 = store.appendUserMessage(original.id, 't1', 'Hello');
    const msg2 = store.startAssistantMessage(original.id, 't1', 'agent-x', 'openai', 'gpt-4o');
    store.finalizeAssistant(msg2.id, {
      providerId: 'openai',
      modelId: 'gpt-4o',
      agentId: 'agent-x',
      messages: [{ role: 'user', content: 'Hello' }],
    }, 'stop');

    // This is exactly what sessionRouter.fork.mutate does:
    const forked = store.forkSession(msg2.id);
    const result = store.getSession(forked.id)!;

    expect(result.id).not.toBe(original.id);
    expect(result.title).toBe('To Fork');
    expect(result.parentMessageId).toBe(msg2.id);
    expect(store.listMessages(result.id)).toHaveLength(2);
  });

  it('throws when forking a nonexistent message', () => {
    const store = new SessionStore(db);
    expect(() => store.forkSession('nonexistent-msg-id')).toThrow('Parent message nonexistent-msg-id not found');
  });

  it('throws when forking from a deleted session context', () => {
    const store = new SessionStore(db);

    // Create session and message, then delete session
    const session = store.createSession({ title: 'Will Delete' });
    const msg = store.appendUserMessage(session.id, 't1', 'content');
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

    expect(() => store.forkSession(msg.id)).toThrow('Source session not found');
  });

  it('forked session is independent — deleting original does not affect fork', () => {
    const store = new SessionStore(db);

    // Create original session with messages
    const original = store.createSession({ title: 'Original' });
    const msg1 = store.appendUserMessage(original.id, 't1', 'Hello');
    const msg2 = store.startAssistantMessage(original.id, 't1', 'agent-a', 'openai', 'gpt-4o');
    store.finalizeAssistant(msg2.id, {
      providerId: 'openai',
      modelId: 'gpt-4o',
      agentId: 'agent-a',
      messages: [{ role: 'user', content: 'Hello' }],
    }, 'stop');

    // Fork
    const forked = store.forkSession(msg2.id);

    // Delete original session
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(original.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(original.id);

    // Verify fork still exists and has its messages
    const forkedSession = store.getSession(forked.id);
    expect(forkedSession).not.toBeNull();

    const forkedMessages = store.listMessages(forked.id);
    expect(forkedMessages).toHaveLength(2);
    expect(forkedMessages[0].content).toBe('Hello');
  });
});

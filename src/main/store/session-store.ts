// src/main/store/session-store.ts
import type Database from 'better-sqlite3';
import type { Session, Message, MessageMeta, ChatRequest, Participant } from './types.js';

const DEFAULT_PERSONA_ID = '_default';

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Parse participants JSON, accepting both legacy string[] and new Participant[]. */
function parseParticipants(raw: string | null | undefined): Participant[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((p) => {
    if (typeof p === 'string') return { agentId: p, personaId: DEFAULT_PERSONA_ID };
    if (p && typeof p === 'object' && 'agentId' in p) {
      const obj = p as { agentId: string; personaId?: string };
      return { agentId: obj.agentId, personaId: obj.personaId ?? DEFAULT_PERSONA_ID };
    }
    return null;
  }).filter((p): p is Participant => p !== null);
}

function normalizeParticipants(input: ReadonlyArray<string | Participant> | undefined): Participant[] {
  if (!input) return [];
  return input.map((p) =>
    typeof p === 'string'
      ? { agentId: p, personaId: DEFAULT_PERSONA_ID }
      : { agentId: p.agentId, personaId: p.personaId ?? DEFAULT_PERSONA_ID },
  );
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    systemPrompt: (row.system_prompt as string | null) ?? null,
    visibilityMode: (row.visibility_mode as 'independent' | 'full') ?? 'independent',
    groupMode: (row.group_mode as 'parallel' | 'relay') ?? 'parallel',
    defaultAgentId: (row.default_agent_id as string | null) ?? null,
    participants: parseParticipants(row.participants as string | null),
    folderId: (row.folder_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    pinned: (row.pinned as number) === 1,
    archived: (row.archived as number) === 1,
    parentMessageId: (row.parent_message_id as string | null) ?? null,
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    turnId: row.turn_id as string,
    role: row.role as 'user' | 'assistant' | 'system',
    modelId: (row.model_id as string | null) ?? null,
    content: (row.content as string) ?? '',
    promptTokens: (row.prompt_tokens as number | null) ?? null,
    completionTokens: (row.completion_tokens as number | null) ?? null,
    status: (row.status as 'streaming' | 'done' | 'error' | 'aborted' | 'partial') ?? 'streaming',
    error: (row.error as string | null) ?? null,
    parentMessageId: (row.parent_message_id as string | null) ?? null,
    metaJson: (row.meta_json as string | null) ?? null,
    createdAt: row.created_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
  };
}

export interface CreateSessionInput {
  title?: string;
  systemPrompt?: string;
  participants?: ReadonlyArray<string | Participant>;
  folderId?: string;
  projectId?: string;
}

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

  // ── Session operations ──────────────────────────────────

  createSession(input: CreateSessionInput = {}): Session {
    const id = uuid();
    const t = now();
    const participants = JSON.stringify(normalizeParticipants(input.participants));
    this.db
      .prepare(
        `INSERT INTO sessions(id, title, created_at, updated_at, system_prompt, participants, folder_id, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.title ?? null, t, t, input.systemPrompt ?? null, participants, input.folderId ?? null, input.projectId ?? null);
    return this.getSession(id)!;
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }

  listSessions(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  setDefaultAgent(sessionId: string, agentId: string): void {
    this.db.prepare('UPDATE sessions SET default_agent_id = ?, updated_at = ? WHERE id = ?').run(agentId, now(), sessionId);
  }

  setVisibilityMode(sessionId: string, mode: 'independent' | 'full'): void {
    this.db.prepare('UPDATE sessions SET visibility_mode = ?, updated_at = ? WHERE id = ?').run(mode, now(), sessionId);
  }

  /** Idempotently add an agent to the session's participant list with the default persona. */
  ensureParticipant(sessionId: string, agentId: string): Participant[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    if (session.participants.some((p) => p.agentId === agentId)) return session.participants;
    const next = [...session.participants, { agentId, personaId: DEFAULT_PERSONA_ID }];
    this.db
      .prepare('UPDATE sessions SET participants = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), now(), sessionId);
    return next;
  }

  /** Update the persona for a single participant. No-op if agent isn't a participant. */
  setParticipantPersona(sessionId: string, agentId: string, personaId: string): Participant[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    const next = session.participants.map((p) =>
      p.agentId === agentId ? { ...p, personaId } : p,
    );
    this.db
      .prepare('UPDATE sessions SET participants = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), now(), sessionId);
    return next;
  }

  // ── Message operations ──────────────────────────────────

  appendUserMessage(sessionId: string, turnId: string, text: string, parentMessageId?: string): Message {
    const id = uuid();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO messages(id, session_id, turn_id, role, content, status, parent_message_id, created_at)
         VALUES (?, ?, ?, 'user', ?, 'done', ?, ?)`,
      )
      .run(id, sessionId, turnId, text, parentMessageId ?? null, t);
    // bump session updated_at
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(t, sessionId);
    return this.getMessage(id)!;
  }

  startAssistantMessage(sessionId: string, turnId: string, agentId: string, providerId: string, modelId: string): Message {
    const id = uuid();
    const t = now();
    // Store minimal meta with agent/provider info for later retrieval
    const metaJson = JSON.stringify({ agentId, providerId, modelId });
    this.db
      .prepare(
        `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, status, meta_json, created_at)
         VALUES (?, ?, ?, 'assistant', ?, '', 'streaming', ?, ?)`,
      )
      .run(id, sessionId, turnId, modelId, metaJson, t);
    return this.getMessage(id)!;
  }

  appendDelta(msgId: string, delta: string): void {
    this.db.prepare('UPDATE messages SET content = content || ? WHERE id = ?').run(delta, msgId);
  }

  finalizeAssistant(msgId: string, meta: MessageMeta, finishReason: string, usage?: { promptTokens: number; completionTokens: number }): void {
    const t = now();
    // Merge incoming meta with existing meta (preserve agentId/providerId/modelId set at start)
    const existingRow = this.db
      .prepare('SELECT meta_json FROM messages WHERE id = ?')
      .get(msgId) as { meta_json: string | null } | undefined;
    let existing: Record<string, unknown> = {};
    if (existingRow?.meta_json) {
      try { existing = JSON.parse(existingRow.meta_json); } catch { /* keep empty */ }
    }
    const metaJson = JSON.stringify({ ...existing, ...(meta as object) });
    if (usage) {
      this.db
        .prepare(
          `UPDATE messages SET status = 'done', meta_json = ?, prompt_tokens = ?, completion_tokens = ?, finished_at = ? WHERE id = ?`,
        )
        .run(metaJson, usage.promptTokens, usage.completionTokens, t, msgId);
    } else {
      this.db
        .prepare(`UPDATE messages SET status = 'done', meta_json = ?, finished_at = ? WHERE id = ?`)
        .run(metaJson, t, msgId);
    }
  }

  markPartial(msgId: string, meta: MessageMeta, usage?: { promptTokens: number; completionTokens: number }): void {
    const metaJson = JSON.stringify(meta);
    if (usage) {
      this.db
        .prepare(
          `UPDATE messages SET status = 'partial', meta_json = ?, prompt_tokens = ?, completion_tokens = ? WHERE id = ?`,
        )
        .run(metaJson, usage.promptTokens, usage.completionTokens, msgId);
    } else {
      this.db.prepare(`UPDATE messages SET status = 'partial', meta_json = ? WHERE id = ?`).run(metaJson, msgId);
    }
  }

  markError(msgId: string, code: string, message: string): void {
    const t = now();
    this.db
      .prepare(`UPDATE messages SET status = 'error', error = ?, finished_at = ? WHERE id = ?`)
      .run(`${code}: ${message}`, t, msgId);
  }

  markAborted(msgId: string): void {
    const t = now();
    this.db.prepare(`UPDATE messages SET status = 'aborted', finished_at = ? WHERE id = ?`).run(t, msgId);
  }

  retry(msgId: string): ChatRequest {
    const row = this.db.prepare('SELECT meta_json FROM messages WHERE id = ?').get(msgId) as { meta_json: string | null } | undefined;
    if (!row?.meta_json) throw new Error(`Cannot retry message ${msgId}: no meta_json`);
    const meta = JSON.parse(row.meta_json) as MessageMeta;
    return {
      providerId: meta.providerId,
      modelId: meta.modelId,
      messages: meta.messages,
    };
  }

  continueAssistant(msgId: string): ChatRequest {
    const row = this.db.prepare('SELECT meta_json FROM messages WHERE id = ?').get(msgId) as { meta_json: string | null } | undefined;
    if (!row?.meta_json) throw new Error(`Cannot continue message ${msgId}: no meta_json`);
    const meta = JSON.parse(row.meta_json) as MessageMeta;
    // Append the partial content as the last assistant message
    const msg = this.getMessage(msgId)!;
    const continuedMessages = [...meta.messages, { role: 'assistant' as const, content: msg.content }];
    return {
      providerId: meta.providerId,
      modelId: meta.modelId,
      messages: continuedMessages,
    };
  }

  // ── Search (FTS5) ──────────────────────────────────────

  search(query: string, limit = 50): Message[] {
    // Quote the query as an FTS5 phrase to avoid parse errors on special chars
    const escaped = query.replace(/"/g, '""');
    const ftsQuery = `"${escaped}"`;
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m
         JOIN messages_fts fts ON m.rowid = fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }

  // ── Fork ────────────────────────────────────────────────

  forkSession(parentMessageId: string): Session {
    // Find the source message and its session
    const sourceMsg = this.db
      .prepare('SELECT rowid, * FROM messages WHERE id = ?')
      .get(parentMessageId) as Record<string, unknown> | undefined;
    if (!sourceMsg) throw new Error(`Parent message ${parentMessageId} not found`);

    const sourceSession = this.getSession(sourceMsg.session_id as string);
    if (!sourceSession) throw new Error(`Source session not found`);

    // Create new session
    const newId = uuid();
    const t = now();
    const participants = JSON.stringify(sourceSession.participants);
    this.db
      .prepare(
        `INSERT INTO sessions(id, title, created_at, updated_at, system_prompt, visibility_mode, group_mode,
         default_agent_id, participants, folder_id, project_id, pinned, archived, parent_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        sourceSession.title,
        t,
        t,
        sourceSession.systemPrompt,
        sourceSession.visibilityMode,
        sourceSession.groupMode,
        sourceSession.defaultAgentId,
        participants,
        sourceSession.folderId,
        sourceSession.projectId,
        sourceSession.pinned ? 1 : 0,
        sourceSession.archived ? 1 : 0,
        parentMessageId,
      );

    // Copy messages up to and including the parent message (using rowid for reliable ordering)
    const parentRowid = sourceMsg.rowid as number;
    const messages = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? AND rowid <= ? ORDER BY rowid')
      .all(sourceSession.id, parentRowid) as Record<string, unknown>[];

    // Build old→new id mapping for parent_message_id rewriting
    const idMap = new Map<string, string>();

    const insertMsg = this.db.prepare(
      `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, prompt_tokens,
       completion_tokens, status, error, parent_message_id, meta_json, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = this.db.transaction((rows: { old: Record<string, unknown>; newId: string; newParentId: string | null }[]) => {
      for (const r of rows) {
        const old = r.old;
        insertMsg.run(
          r.newId,
          newId,
          old.turn_id,
          old.role,
          old.model_id ?? null,
          old.content ?? '',
          old.prompt_tokens ?? null,
          old.completion_tokens ?? null,
          old.status,
          old.error ?? null,
          r.newParentId,
          old.meta_json ?? null,
          old.created_at,
          old.finished_at ?? null,
        );
      }
    });

    const rowsToInsert = messages.map((old) => {
      const newId = uuid();
      idMap.set(old.id as string, newId);
      const oldParentId = old.parent_message_id as string | null;
      const newParentId = oldParentId && idMap.has(oldParentId) ? idMap.get(oldParentId)! : null;
      return { old, newId, newParentId };
    });

    insertMany(rowsToInsert);

    return this.getSession(newId)!;
  }

  // ── Internal helpers ────────────────────────────────────

  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessage(row) : null;
  }

  listMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  }
}

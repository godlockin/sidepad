import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { SessionStore } from '../../store/session-store.js';
import { createSessionToolsStore } from '../../store/session-tools-store.js';
import { PersonaStore, DEFAULT_PERSONA_ID } from '../../store/persona-store.js';

const t = initTRPC.create({ isServer: true });

function getStore(): SessionStore {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return new SessionStore(db);
}

function getDb(): Database.Database {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return db;
}

export const sessionRouter = t.router({
  list: t.procedure.query(() => {
    return getStore().listSessions();
  }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const session = getStore().getSession(input.id);
      if (!session) throw new Error(`Session "${input.id}" not found`);
      return session;
    }),

  create: t.procedure
    .input(
      z.object({
        title: z.string().optional(),
        defaultAgentId: z.string().optional(),
        visibilityMode: z.enum(['independent', 'full']).optional(),
        participants: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.createSession({
        title: input.title,
        participants: input.participants,
      });
      if (input.defaultAgentId) {
        store.setDefaultAgent(session.id, input.defaultAgentId);
      }
      if (input.visibilityMode) {
        store.setVisibilityMode(session.id, input.visibilityMode);
      }
      return store.getSession(session.id)!;
    }),

  rename: t.procedure
    .input(z.object({ id: z.string(), title: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.id);
      if (!session) throw new Error(`Session "${input.id}" not found`);
      getDb()
        .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(input.title, Math.floor(Date.now() / 1000), input.id);
      return store.getSession(input.id)!;
    }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.id);
      if (!session) throw new Error(`Session "${input.id}" not found`);
      getDb().prepare('DELETE FROM messages WHERE session_id = ?').run(input.id);
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(input.id);
      return { ok: true };
    }),

  fork: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        parentMessageId: z.string(),
        title: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const store = getStore();
      const forked = store.forkSession(input.parentMessageId);
      if (input.title) {
        getDb()
          .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
          .run(input.title, Math.floor(Date.now() / 1000), forked.id);
      }
      return store.getSession(forked.id)!;
    }),

  setDefaultAgent: t.procedure
    .input(z.object({ sessionId: z.string(), agentId: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      store.setDefaultAgent(input.sessionId, input.agentId);
      return store.getSession(input.sessionId)!;
    }),

  setVisibilityMode: t.procedure
    .input(z.object({ sessionId: z.string(), mode: z.enum(['independent', 'full']) }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      store.setVisibilityMode(input.sessionId, input.mode);
      return store.getSession(input.sessionId)!;
    }),

  setIcon: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        kind: z.enum(['emoji', 'image']).nullable(),
        value: z.string().nullable(),
      }),
    )
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      store.setIcon(input.sessionId, input.kind, input.value);
      return store.getSession(input.sessionId)!;
    }),

  search: t.procedure
    .input(z.object({ query: z.string() }))
    .query(({ input }) => {
      return getStore().search(input.query);
    }),

  messages: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const session = getStore().getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      return getStore().listMessages(input.sessionId);
    }),

  setParticipantPersona: t.procedure
    .input(z.object({ sessionId: z.string(), agentId: z.string(), personaId: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      // Make sure the agent is a participant first (idempotent)
      store.ensureParticipant(input.sessionId, input.agentId);
      const next = store.setParticipantPersona(input.sessionId, input.agentId, input.personaId);
      return { participants: next };
    }),

  attachSkill: t.procedure
    .input(z.object({ sessionId: z.string(), skillId: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      createSessionToolsStore(getDb()).attach(input.sessionId, 'skill', input.skillId);
      return { ok: true };
    }),

  detachSkill: t.procedure
    .input(z.object({ sessionId: z.string(), skillId: z.string() }))
    .mutation(({ input }) => {
      createSessionToolsStore(getDb()).detach(input.sessionId, 'skill', input.skillId);
      return { ok: true };
    }),

  listAttachedSkills: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return createSessionToolsStore(getDb())
        .list(input.sessionId, 'skill')
        .map((r) => r.refId);
    }),

  attachTool: t.procedure
    .input(z.object({ sessionId: z.string(), toolName: z.string() }))
    .mutation(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      createSessionToolsStore(getDb()).attach(input.sessionId, 'mcp_tool', input.toolName);
      return { ok: true };
    }),

  detachTool: t.procedure
    .input(z.object({ sessionId: z.string(), toolName: z.string() }))
    .mutation(({ input }) => {
      createSessionToolsStore(getDb()).detach(input.sessionId, 'mcp_tool', input.toolName);
      return { ok: true };
    }),

  listAttachedTools: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return createSessionToolsStore(getDb())
        .list(input.sessionId, 'mcp_tool')
        .map((r) => r.refId);
    }),

  exportMarkdown: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const store = getStore();
      const session = store.getSession(input.sessionId);
      if (!session) throw new Error(`Session "${input.sessionId}" not found`);
      const messages = store.listMessages(input.sessionId);
      const personaStore = new PersonaStore(getDb());

      const personaForAgent = (agentId: string): string | null => {
        const participant = session.participants.find((p) => p.agentId === agentId);
        if (!participant) return null;
        if (participant.personaId === DEFAULT_PERSONA_ID) return null;
        const persona = personaStore.get(participant.personaId);
        return persona?.name ?? null;
      };

      const fmtTime = (ts: number): string => {
        const d = new Date(ts * 1000);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      };

      const title = session.title ?? 'Untitled conversation';
      const lines: string[] = [];
      lines.push(`# ${title}`);
      lines.push('');
      lines.push(`_Exported ${new Date().toISOString()}_`);
      lines.push('');

      for (const msg of messages) {
        let agentId = '';
        let reasoning: string | null = null;
        if (msg.metaJson) {
          try {
            const meta = JSON.parse(msg.metaJson) as Record<string, unknown>;
            if (typeof meta.agentId === 'string') agentId = meta.agentId;
            if (typeof meta.reasoning === 'string') reasoning = meta.reasoning;
          } catch {
            /* ignore */
          }
        }

        // Also check for a reasoning column if it exists on the row.
        try {
          const row = getDb()
            .prepare('SELECT reasoning FROM messages WHERE id = ?')
            .get(msg.id) as { reasoning?: string | null } | undefined;
          if (row && typeof row.reasoning === 'string' && row.reasoning) {
            reasoning = row.reasoning;
          }
        } catch {
          /* column doesn't exist yet */
        }

        let authorDisplay: string;
        if (msg.role === 'user') {
          authorDisplay = 'You';
        } else {
          authorDisplay = personaForAgent(agentId) ?? agentId ?? 'assistant';
        }

        const headerAgent = msg.role === 'user' ? 'user' : agentId || 'assistant';
        lines.push(`## ${authorDisplay} · ${headerAgent} · ${fmtTime(msg.createdAt)}`);
        lines.push('');
        if (reasoning) {
          lines.push('<details><summary>thinking</summary>');
          lines.push('');
          lines.push(reasoning);
          lines.push('');
          lines.push('</details>');
          lines.push('');
        }
        lines.push(msg.content ?? '');
        lines.push('');
        lines.push('---');
        lines.push('');
      }

      return lines.join('\n');
    }),
});

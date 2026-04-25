import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { SessionStore } from '../../store/session-store.js';
import { createSessionToolsStore } from '../../store/session-tools-store.js';

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
});

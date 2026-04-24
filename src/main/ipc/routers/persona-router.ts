import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { PersonaStore, DEFAULT_PERSONA_ID } from '../../store/persona-store.js';

const t = initTRPC.create({ isServer: true });

function getStore(): PersonaStore {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return new PersonaStore(db);
}

export const personaRouter = t.router({
  list: t.procedure.query(() => {
    return getStore().list();
  }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const persona = getStore().get(input.id);
      if (!persona) throw new Error(`Persona "${input.id}" not found`);
      return persona;
    }),

  create: t.procedure
    .input(z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      prompt: z.string().min(1),
    }))
    .mutation(({ input }) => {
      return getStore().create(input);
    }),

  update: t.procedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
    }))
    .mutation(({ input }) => {
      const persona = getStore().update(input.id, { name: input.name, prompt: input.prompt });
      if (!persona) throw new Error(`Persona "${input.id}" not found`);
      return persona;
    }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      if (input.id === DEFAULT_PERSONA_ID) {
        throw new Error('Cannot delete default persona');
      }
      const ok = getStore().delete(input.id);
      if (!ok) throw new Error(`Persona "${input.id}" not found`);
      return { ok: true };
    }),
});

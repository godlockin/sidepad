import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createMCPStore } from '../../store/mcp-store.js';
import type { MCPRegistry } from '../../mcp/registry.js';

const t = initTRPC.create({ isServer: true });

function getDb(): Database.Database {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return db;
}

function getRegistry(): MCPRegistry {
  const reg = (globalThis as any).sidepad?.mcp as MCPRegistry | undefined;
  if (!reg) throw new Error('MCP registry not available');
  return reg;
}

export const mcpRouter = t.router({
  list: t.procedure.query(() => createMCPStore(getDb()).list()),

  add: t.procedure
    .input(
      z.object({
        name: z.string().min(1),
        transport: z.enum(['stdio', 'http', 'sse']),
        config: z.record(z.unknown()),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const store = createMCPStore(getDb());
      const id = store.create(input);
      if (input.enabled) {
        const rec = store.get(id)!;
        await getRegistry().connect(rec);
      }
      return id;
    }),

  setEnabled: t.procedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const store = createMCPStore(getDb());
      store.setEnabled(input.id, input.enabled);
      const rec = store.get(input.id);
      if (!rec) throw new Error(`mcp server ${input.id} not found`);
      const reg = getRegistry();
      if (input.enabled) await reg.connect(rec);
      else await reg.disconnect(input.id);
    }),

  remove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await getRegistry().disconnect(input.id);
      createMCPStore(getDb()).remove(input.id);
    }),

  listTools: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getRegistry().listTools(input.id)),

  testConnection: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const rec = createMCPStore(getDb()).get(input.id);
      if (!rec) throw new Error(`mcp server ${input.id} not found`);
      const reg = getRegistry();
      if (!reg.isConnected(input.id)) await reg.connect(rec);
      return reg.listTools(input.id);
    }),
});

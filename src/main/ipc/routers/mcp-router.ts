import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import { createMCPStore } from '../../store/mcp-store.js';
import type { MCPRegistry } from '../../mcp/registry.js';
import {
  installChromium,
  isChromiumInstalled,
  getBrowsersPath,
} from '../../mcp/browser-installer.js';

const t = initTRPC.create({ isServer: true });

const BROWSER_DEPENDENT_IDS = new Set(['bundled-web-browse', 'bundled-web-crawl']);

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
      const requiresBrowser =
        input.enabled &&
        BROWSER_DEPENDENT_IDS.has(input.id) &&
        !isChromiumInstalled();
      return { ok: true, requiresBrowser };
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

  /**
   * Lightweight check: is Playwright Chromium present in the user's data dir?
   * Used by the renderer to render install prompts in Settings → Tools.
   */
  isBrowserInstalled: t.procedure.query(() => isChromiumInstalled()),

  /**
   * Install Playwright Chromium into the user's data dir using the bundled
   * Playwright client driven by the Electron binary in node mode (no `npx`).
   * Streams stdout/stderr lines to the renderer as a tRPC subscription.
   */
  installBrowser: t.procedure.subscription(() => {
    type Event =
      | { type: 'progress'; line: string }
      | { type: 'done'; ok: boolean; code: number; browsersPath: string; error?: string }
      | { type: 'error'; line: string };
    return observable<Event>((emit) => {
      let cancelled = false;
      installChromium((line) => {
        if (!cancelled) emit.next({ type: 'progress', line });
      })
        .then((res) => {
          if (cancelled) return;
          emit.next({
            type: 'done',
            ok: res.ok,
            code: res.code,
            browsersPath: getBrowsersPath(),
            error: res.error,
          });
          emit.complete();
        })
        .catch((err) => {
          if (cancelled) return;
          emit.next({ type: 'error', line: String(err) });
          emit.complete();
        });
      return () => {
        cancelled = true;
      };
    });
  }),
});

import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import { z } from 'zod';
import { dialog } from 'electron';
import type Database from 'better-sqlite3';
import {
  indexDocument,
  listKnowledge,
  deleteKnowledge,
  searchKnowledge,
  subscribeProgress,
  type IndexProgress,
} from '../../kb/index.js';
import {
  getEmbedderConfig,
  setEmbedderConfig,
} from '../../kb/embedder.js';

const t = initTRPC.create({ isServer: true });

function getDb(): Database.Database {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return db;
}

export const knowledgeRouter = t.router({
  add: t.procedure
    .input(
      z.object({
        sourceType: z.enum(['file', 'folder', 'attachment', 'url']),
        sourcePath: z.string(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await indexDocument(getDb(), input);
    }),

  list: t.procedure.query(() => {
    return listKnowledge(getDb());
  }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      deleteKnowledge(getDb(), input.id);
      return { ok: true };
    }),

  search: t.procedure
    .input(
      z.object({
        query: z.string(),
        k: z.number().int().min(1).max(50).optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const hits = await searchKnowledge(getDb(), input.query, input.k ?? 5, {
        tags: input.tags,
      });
      return hits;
    }),

  onProgress: t.procedure
    .input(z.object({ documentId: z.string() }))
    .subscription(({ input }) => {
      return observable<IndexProgress, Error>(
        (observer: Observer<IndexProgress, Error>): TeardownLogic => {
          const off = subscribeProgress(input.documentId, (p) => observer.next(p));
          return () => {
            off();
          };
        },
      );
    }),

  getEmbedderConfig: t.procedure.query(() => {
    const c = getEmbedderConfig(getDb());
    // Don't expose the api key in plaintext to the renderer.
    return {
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl,
      apiKeySet: !!c.apiKey,
    };
  }),

  setEmbedderConfig: t.procedure
    .input(
      z.object({
        provider: z.enum(['ollama', 'openai']),
        model: z.string(),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      setEmbedderConfig(getDb(), input);
      return { ok: true };
    }),

  pickFile: t.procedure.mutation(async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'md', 'txt', 'csv', 'json', 'html', 'htm'],
        },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return { path: null };
    return { path: res.filePaths[0] };
  }),

  pickFolder: t.procedure.mutation(async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return { path: null };
    return { path: res.filePaths[0] };
  }),
});

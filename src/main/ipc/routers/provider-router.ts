import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { registry } from '../../providers/index.js';
import { loadProviders } from '../../providers/factory.js';
import { OpenAIProvider } from '../../providers/openai.js';
import { AnthropicProvider } from '../../providers/anthropic.js';
import { OllamaProvider } from '../../providers/ollama.js';
import { OpenAICompatProvider } from '../../providers/openai-compat.js';
import type { LLMProvider } from '../../providers/types.js';

const t = initTRPC.create({ isServer: true });

export const providerRouter = t.router({
  list: t.procedure.query(() => {
    const providers = registry.list();
    const db = (globalThis as any).sidepad?.db;
    const rows = db
      ? (db
          .prepare('SELECT id, icon_kind, icon_value FROM provider_configs')
          .all() as Array<{ id: string; icon_kind: string | null; icon_value: string | null }>)
      : [];
    const iconMap = new Map(rows.map((r) => [r.id, { kind: r.icon_kind, value: r.icon_value }]));
    return providers.map((p) => ({
      id: p.id,
      configId: p.configId,
      iconKind: (iconMap.get(p.configId)?.kind ?? null) as 'emoji' | 'image' | null,
      iconValue: iconMap.get(p.configId)?.value ?? null,
    }));
  }),

  setIcon: t.procedure
    .input(
      z.object({
        configId: z.string(),
        kind: z.enum(['emoji', 'image']).nullable(),
        value: z.string().nullable(),
      }),
    )
    .mutation(({ input }) => {
      const db = (globalThis as any).sidepad?.db;
      if (!db) throw new Error('Database not available');
      db.prepare(
        'UPDATE provider_configs SET icon_kind = ?, icon_value = ? WHERE id = ?',
      ).run(input.kind, input.value, input.configId);
      return { ok: true };
    }),

  listModels: t.procedure
    .input(
      z.object({
        type: z.enum(['openai', 'anthropic', 'ollama', 'openai-compat']),
        baseURL: z.string().optional(),
        apiKey: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        let provider: LLMProvider;
        switch (input.type) {
          case 'openai':
            provider = new OpenAIProvider(
              '__probe__',
              '__probe__',
              input.apiKey ?? '',
              input.baseURL || undefined,
            );
            break;
          case 'anthropic':
            provider = new AnthropicProvider('__probe__', '__probe__', input.apiKey ?? '');
            break;
          case 'ollama':
            provider = new OllamaProvider('__probe__', '__probe__', input.baseURL || undefined);
            break;
          case 'openai-compat':
            if (!input.baseURL) {
              return { ok: false as const, error: 'baseURL required for openai-compat' };
            }
            provider = new OpenAICompatProvider(
              '__probe__',
              '__probe__',
              input.apiKey ?? '',
              input.baseURL,
            );
            break;
        }
        const models = await provider!.listModels();
        return {
          ok: true as const,
          models: models.map((m) => ({ id: m.id, label: m.name, caps: m.caps ?? {} })),
        };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),

  testModel: t.procedure
    .input(
      z.object({
        type: z.enum(['openai', 'anthropic', 'ollama', 'openai-compat']),
        baseURL: z.string().optional(),
        apiKey: z.string().optional(),
        model: z.string(),
      }),
    )
    .query(async ({ input }) => {
      try {
        let provider: LLMProvider;
        switch (input.type) {
          case 'openai':
            provider = new OpenAIProvider('__probe__', '__probe__', input.apiKey ?? '', input.baseURL || undefined);
            break;
          case 'anthropic':
            provider = new AnthropicProvider('__probe__', '__probe__', input.apiKey ?? '');
            break;
          case 'ollama':
            provider = new OllamaProvider('__probe__', '__probe__', input.baseURL || undefined);
            break;
          case 'openai-compat':
            if (!input.baseURL) return { ok: false as const, error: 'baseURL required' };
            provider = new OpenAICompatProvider('__probe__', '__probe__', input.apiKey ?? '', input.baseURL);
            break;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const reqPayload = {
          model: input.model,
          messages: [{ role: 'user' as const, content: 'hi' }],
          maxTokens: 1,
          tools: [] as never[],
        };
        try {
          const stream = provider!.chat(reqPayload, ctrl.signal);
          let firstChunk: unknown = null;
          for await (const chunk of stream) { firstChunk = chunk; break; }
          return {
            ok: true as const,
            request: reqPayload,
            response: firstChunk,
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          request: { model: input.model, messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 },
        };
      }
    }),

  getConfig: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = (globalThis as any).sidepad?.db;
      if (!db) throw new Error('Database not available');
      const row = db.prepare('SELECT id, type, base_url, params_json FROM provider_configs WHERE id = ?').get(input.id) as
        | { id: string; type: string; base_url: string | null; params_json: string | null }
        | undefined;
      if (!row) return null;
      const params = row.params_json ? (JSON.parse(row.params_json) as { defaultModel?: string }) : {};
      return {
        id: row.id,
        type: row.type as 'openai' | 'anthropic' | 'ollama' | 'openai-compat',
        baseURL: row.base_url ?? undefined,
        defaultModel: params.defaultModel,
      };
    }),

  remove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = (globalThis as any).sidepad?.db;
      const secrets = (globalThis as any).sidepad?.secrets;
      if (!db) throw new Error('Database not available');
      db.prepare('DELETE FROM provider_configs WHERE id = ?').run(input.id);
      if (secrets) { try { secrets.delete(input.id); } catch { /* ok */ } }
      try { loadProviders(db, secrets, registry); } catch { /* ok */ }
      return { ok: true };
    }),

  configure: t.procedure
    .input(
      z.object({
        id: z.string(),
        type: z.enum(['openai', 'anthropic', 'ollama', 'openai-compat']),
        apiKey: z.string().optional(),
        baseURL: z.string().optional(),
        defaultModel: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = (globalThis as any).sidepad?.db;
      const secrets = (globalThis as any).sidepad?.secrets;
      if (!db) throw new Error('Database not available');

      const paramsJson = input.defaultModel
        ? JSON.stringify({ defaultModel: input.defaultModel })
        : null;

      // Upsert into provider_configs
      db.prepare(
        `INSERT INTO provider_configs(id, type, name, base_url, params_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET type = excluded.type, base_url = excluded.base_url, params_json = excluded.params_json`,
      ).run(input.id, input.type, input.id, input.baseURL ?? null, paramsJson);

      // Store API key if provided
      if (input.apiKey && secrets) {
        secrets.set(input.id, input.apiKey);
      }

      // Attempt to reload providers into the registry (may fail if 'enabled' column not yet added)
      try {
        loadProviders(db, secrets, registry);
      } catch {
        // loadProviders expects an 'enabled' column; if not present yet, skip reload
      }

      return { ok: true };
    }),

  health: t.procedure
    .input(z.object({ providerId: z.string() }))
    .query(async ({ input }) => {
      try {
        const provider = registry.get(input.providerId);
        const models = await provider.listModels();
        return { ok: true, providerId: input.providerId, modelCount: models.length };
      } catch (err) {
        return {
          ok: false,
          providerId: input.providerId,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
});

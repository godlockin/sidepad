import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { registry } from '../../providers/index.js';
import { loadProviders } from '../../providers/factory.js';

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
    .input(z.object({ providerId: z.string() }))
    .query(async ({ input }) => {
      const provider = registry.get(input.providerId);
      const models = await provider.listModels();
      return models;
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

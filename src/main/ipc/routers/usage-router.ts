import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { createUsageStore } from '../../store/usage-store.js';

const t = initTRPC.create({ isServer: true });

function db(): Database.Database {
  const d = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!d) throw new Error('database not available');
  return d;
}

const pricingEntry = z.object({
  inputPer1M: z.number().finite().min(0),
  outputPer1M: z.number().finite().min(0),
});

export const usageRouter = t.router({
  /**
   * Aggregate token usage from assistant messages.
   * `days` null / omitted = all time; otherwise look back N calendar days.
   */
  summarize: t.procedure
    .input(
      z
        .object({
          days: z.number().int().positive().max(3650).nullable().optional(),
          sessionLimit: z.number().int().positive().max(100).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      const store = createUsageStore(db());
      const days = input?.days;
      const since =
        days == null || days === undefined
          ? null
          : Math.floor(Date.now() / 1000) - days * 86_400;
      return store.summarize({ since, sessionLimit: input?.sessionLimit });
    }),

  getPricing: t.procedure.query(() => {
    return createUsageStore(db()).getPricing();
  }),

  setPricing: t.procedure
    .input(z.object({ pricing: z.record(z.string().min(1), pricingEntry) }))
    .mutation(({ input }) => {
      createUsageStore(db()).setPricing(input.pricing);
      return { ok: true as const };
    }),

  upsertPricing: t.procedure
    .input(
      z.object({
        modelId: z.string().min(1).max(200),
        inputPer1M: z.number().finite().min(0),
        outputPer1M: z.number().finite().min(0),
      }),
    )
    .mutation(({ input }) => {
      const store = createUsageStore(db());
      const pricing = { ...store.getPricing() };
      pricing[input.modelId] = {
        inputPer1M: input.inputPer1M,
        outputPer1M: input.outputPer1M,
      };
      store.setPricing(pricing);
      return { ok: true as const };
    }),

  deletePricing: t.procedure
    .input(z.object({ modelId: z.string().min(1) }))
    .mutation(({ input }) => {
      const store = createUsageStore(db());
      const pricing = { ...store.getPricing() };
      delete pricing[input.modelId];
      store.setPricing(pricing);
      return { ok: true as const };
    }),
});

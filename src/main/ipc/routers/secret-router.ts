import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create({ isServer: true });

export const secretRouter = t.router({
  has: t.procedure
    .input(z.object({ providerConfigId: z.string() }))
    .query(({ input }) => {
      const secrets = (globalThis as any).sidepad?.secrets;
      if (!secrets) throw new Error('SecretStore not available');
      return secrets.has(input.providerConfigId);
    }),

  set: t.procedure
    .input(z.object({ providerConfigId: z.string(), plaintext: z.string() }))
    .mutation(({ input }) => {
      const secrets = (globalThis as any).sidepad?.secrets;
      if (!secrets) throw new Error('SecretStore not available');
      secrets.set(input.providerConfigId, input.plaintext);
      return { ok: true };
    }),

  delete: t.procedure
    .input(z.object({ providerConfigId: z.string() }))
    .mutation(({ input }) => {
      const secrets = (globalThis as any).sidepad?.secrets;
      if (!secrets) throw new Error('SecretStore not available');
      secrets.delete(input.providerConfigId);
      return { ok: true };
    }),
});

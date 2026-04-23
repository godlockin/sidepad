import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create({ isServer: true });

export const pingRouter = t.router({
  echo: t.procedure
    .input(z.object({ text: z.string() }))
    .query(({ input }) => ({ text: input.text, at: Date.now() })),
});

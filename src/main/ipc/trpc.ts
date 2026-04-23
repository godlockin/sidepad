import { initTRPC } from '@trpc/server';
import { pingRouter } from './routers/ping.js';
import { systemRouter } from './routers/system.js';

const t = initTRPC.create({ isServer: true });

export const appRouter = t.router({
  ping: pingRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;

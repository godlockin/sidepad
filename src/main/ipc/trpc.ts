import { initTRPC } from '@trpc/server';
import { pingRouter } from './routers/ping.js';
import { spikeChatRouter } from './routers/spike-chat.js';
import { systemRouter } from './routers/system.js';
import { sessionRouter } from './routers/session-router.js';
import { chatRouter } from './routers/chat-router.js';
import { providerRouter } from './routers/provider-router.js';
import { classifierRouter } from './routers/classifier-router.js';

const t = initTRPC.create({ isServer: true });

import { secretRouter } from './routers/secret-router.js';

export const appRouter = t.router({
  ping: pingRouter,
  spike: spikeChatRouter,
  system: systemRouter,
  session: sessionRouter,
  chat: chatRouter,
  provider: providerRouter,
  classifier: classifierRouter,
  secret: secretRouter,
});

export type AppRouter = typeof appRouter;

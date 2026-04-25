import { initTRPC } from '@trpc/server';
import { pingRouter } from './routers/ping.js';
import { spikeChatRouter } from './routers/spike-chat.js';
import { systemRouter } from './routers/system.js';
import { sessionRouter } from './routers/session-router.js';
import { chatRouter } from './routers/chat-router.js';
import { providerRouter } from './routers/provider-router.js';
import { classifierRouter } from './routers/classifier-router.js';
import { personaRouter } from './routers/persona-router.js';
import { mcpRouter } from './routers/mcp-router.js';
import { skillsRouter } from './routers/skills-router.js';
import { attachmentRouter } from './routers/attachment-router.js';
import { settingsRouter } from './routers/settings-router.js';

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
  persona: personaRouter,
  mcp: mcpRouter,
  skills: skillsRouter,
  attachment: attachmentRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;

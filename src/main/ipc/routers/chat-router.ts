import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import { z } from 'zod';
import { SessionStore } from '../../store/session-store.js';
import { ChatOrchestrator } from '../../orchestrator/index.js';
import type { OrchestratorEvent } from '../../orchestrator/types.js';
import { registry } from '../../providers/index.js';

const t = initTRPC.create({ isServer: true });

let orchestrator: ChatOrchestrator | null = null;
const activeTurns = new Map<string, AbortController>();

function getOrchestrator(): ChatOrchestrator {
  if (orchestrator) return orchestrator;

  const db = (globalThis as any).sidepad?.db;
  if (!db) throw new Error('Database not available');

  const store = new SessionStore(db);
  const classifier = null;

  orchestrator = new ChatOrchestrator(
    store,
    registry,
    classifier,
    (agentId: string) => {
      if (registry.has(agentId)) {
        return registry.get(agentId);
      }
      const providers = registry.list();
      return providers.length > 0 ? providers[0] : null;
    },
    () => 'gpt-4o-mini',
  );

  return orchestrator;
}

export const chatRouter = t.router({
  send: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        text: z.string(),
        mentions: z.array(z.string()).default([]),
      }),
    )
    .subscription(({ input }) => {
      return observable<OrchestratorEvent, Error>(
        (observer: Observer<OrchestratorEvent, Error>): TeardownLogic => {
          const ac = new AbortController();
          const orch = getOrchestrator();

          async function run() {
            try {
              for await (const event of orch.send(input, ac.signal)) {
                if (ac.signal.aborted) return;
                // Track the turnId from the turn:start event
                if (event.type === 'turn:start') {
                  activeTurns.set(event.turnId, ac);
                }
                if (event.type === 'turn:complete' || event.type === 'message:error') {
                  if (event.type === 'turn:complete') {
                    activeTurns.delete(event.turnId);
                  }
                }
                observer.next(event);
              }
              observer.complete();
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') {
                observer.complete();
              } else {
                observer.error(err instanceof Error ? err : new Error(String(err)));
              }
            }
          }

          void run();

          return () => {
            ac.abort();
          };
        },
      );
    }),

  retry: t.procedure
    .input(z.object({ sessionId: z.string(), messageId: z.string() }))
    .subscription(({ input }) => {
      return observable<OrchestratorEvent, Error>(
        (observer: Observer<OrchestratorEvent, Error>): TeardownLogic => {
          const ac = new AbortController();
          const orch = getOrchestrator();
          const store = new SessionStore((globalThis as any).sidepad?.db);

          async function run() {
            try {
              const msg = store.getMessage(input.messageId);
              if (!msg) throw new Error(`Message "${input.messageId}" not found`);

              // Extract the original user text from meta_json or use empty
              let text = '';
              if (msg.metaJson) {
                try {
                  const meta = JSON.parse(msg.metaJson);
                  const lastUser = meta.messages?.findLast?.(
                    (m: any) => m.role === 'user',
                  );
                  if (lastUser) text = lastUser.content;
                } catch {
                  // ignore parse errors
                }
              }

              const retryInput = {
                sessionId: input.sessionId,
                text,
                mentions: [],
              };

              for await (const event of orch.send(retryInput, ac.signal)) {
                if (ac.signal.aborted) return;
                observer.next(event);
              }
              observer.complete();
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') {
                observer.complete();
              } else {
                observer.error(err instanceof Error ? err : new Error(String(err)));
              }
            }
          }

          void run();

          return () => {
            ac.abort();
          };
        },
      );
    }),

  cancel: t.procedure
    .input(z.object({ turnId: z.string() }))
    .mutation(({ input }) => {
      const ac = activeTurns.get(input.turnId);
      if (ac) {
        ac.abort();
        activeTurns.delete(input.turnId);
      }
      return { ok: true };
    }),
});

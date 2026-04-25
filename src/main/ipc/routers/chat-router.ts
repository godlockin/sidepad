import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import { z } from 'zod';
import { SessionStore } from '../../store/session-store.js';
import { PersonaStore } from '../../store/persona-store.js';
import { ChatOrchestrator } from '../../orchestrator/index.js';
import { getSessionSkillAddenda } from '../../skills/composer.js';
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
  const personaStore = new PersonaStore(db);
  const classifier = null;

  // Look up the configured model for an agent. Order of precedence:
  //   1. provider_configs.params_json.defaultModel (explicit user override)
  //   2. first entry in provider_configs.model_list_json
  //   3. type-specific fallback
  function resolveModel(agentId: string): string {
    try {
      const row = db
        .prepare('SELECT type, params_json, model_list_json FROM provider_configs WHERE id = ?')
        .get(agentId) as { type?: string; params_json?: string; model_list_json?: string } | undefined;
      if (row) {
        if (row.params_json) {
          try {
            const p = JSON.parse(row.params_json);
            if (p?.defaultModel) return p.defaultModel as string;
          } catch { /* ignore */ }
        }
        if (row.model_list_json) {
          try {
            const list = JSON.parse(row.model_list_json);
            if (Array.isArray(list) && list.length > 0) {
              return typeof list[0] === 'string' ? list[0] : (list[0]?.id ?? list[0]?.name);
            }
          } catch { /* ignore */ }
        }
        // type-specific fallback
        if (row.type === 'anthropic') return 'claude-3-5-haiku-latest';
        if (row.type === 'ollama') return 'qwen2.5:1.5b';
      }
    } catch { /* ignore */ }
    return 'gpt-4o-mini';
  }

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
    resolveModel,
    (sessionId: string, agentId: string) => {
      const session = store.getSession(sessionId);
      if (!session) return null;
      const part = session.participants.find((p) => p.agentId === agentId);
      if (!part) return null;
      const persona = personaStore.get(part.personaId);
      return persona?.prompt ?? null;
    },
    (sessionId: string) => {
      try {
        return getSessionSkillAddenda(db, sessionId);
      } catch {
        return '';
      }
    },
  );

  return orchestrator;
}

/** Auto-add @-mentioned agents as participants of the session before send. */
function ensureMentionedParticipants(sessionId: string, mentions: string[]): void {
  const db = (globalThis as any).sidepad?.db;
  if (!db) return;
  const store = new SessionStore(db);
  for (const agentId of mentions) {
    store.ensureParticipant(sessionId, agentId);
  }
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

          // Auto-add @-mentioned agents to the session participants list with default persona
          ensureMentionedParticipants(input.sessionId, input.mentions);

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

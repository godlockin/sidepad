import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../../store/session-store.js';
import { PersonaStore } from '../../store/persona-store.js';
import { createSessionToolsStore } from '../../store/session-tools-store.js';
import { ChatOrchestrator, type SessionToolResolver } from '../../orchestrator/index.js';
import { getSessionSkillAddenda } from '../../skills/composer.js';
import type { OrchestratorEvent } from '../../orchestrator/types.js';
import { registry } from '../../providers/index.js';
import type { ToolDefinition } from '../../providers/types.js';

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
            if (p?.defaultModel) {
              // Warm context window cache for this agent/model
              void resolveContextWindow(agentId, p.defaultModel as string);
              return p.defaultModel as string;
            }
          } catch { /* ignore */ }
        }
        if (row.model_list_json) {
          try {
            const list = JSON.parse(row.model_list_json);
            if (Array.isArray(list) && list.length > 0) {
              const m = typeof list[0] === 'string' ? list[0] : (list[0]?.id ?? list[0]?.name);
              void resolveContextWindow(agentId, m as string);
              return m as string;
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

  // Cache: agentId → Map<modelId, contextWindow>
  const modelContextWindowCache = new Map<string, Map<string, number>>();

  async function resolveContextWindow(agentId: string, model: string): Promise<number> {
    let modelMap = modelContextWindowCache.get(agentId);
    if (!modelMap) {
      modelMap = new Map();
      modelContextWindowCache.set(agentId, modelMap);
    }
    if (modelMap.has(model)) return modelMap.get(model)!;
    try {
      const provider = registry.has(agentId) ? registry.get(agentId) : (registry.list()[0] ?? null);
      if (provider) {
        const models = await provider.listModels();
        for (const m of models) modelMap.set(m.id, m.contextWindow);
        if (modelMap.has(model)) return modelMap.get(model)!;
      }
    } catch { /* ignore */ }
    return 8000;
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
    buildSessionToolResolver(db),
    (agentId: string, model: string) => {
      // Fire-and-forget async lookup; return cached value synchronously or fallback
      const cached = modelContextWindowCache.get(agentId)?.get(model);
      if (cached !== undefined) return cached;
      // Trigger cache population asynchronously (next call will hit cache)
      void resolveContextWindow(agentId, model);
      return 8000;
    },
  );

  return orchestrator;
}

/**
 * Build a SessionToolResolver bound to the live MCP registry on globalThis.
 * - Reads enabled tool names per session from `session_tools` (kind='mcp_tool').
 * - Resolves each name → serverId via `mcp.listAllTools()`.
 * - Persists every invocation to `mcp_tool_usage`.
 * Returns null if no MCP registry is wired (preserves chat-only behavior).
 */
function buildSessionToolResolver(db: any): SessionToolResolver | null {
  const mcp = (globalThis as any).sidepad?.mcp as
    | {
        listAllTools(): Promise<
          Array<{ serverId: string; name: string; description?: string; inputSchema: unknown }>
        >;
        callTool(
          serverId: string,
          name: string,
          args: Record<string, unknown>,
        ): Promise<unknown>;
      }
    | undefined;
  if (!mcp) return null;

  const sessionToolsStore = createSessionToolsStore(db);

  return {
    async listToolsForSession(sessionId: string) {
      const attached = sessionToolsStore.list(sessionId, 'mcp_tool');
      if (attached.length === 0) return [];
      let allTools: Array<{ serverId: string; name: string; description?: string; inputSchema: unknown }>;
      try {
        allTools = await mcp.listAllTools();
      } catch {
        return [];
      }
      const wanted = new Set(attached.map((a) => a.refId));
      const out: Array<{ tool: ToolDefinition; serverId: string }> = [];
      for (const t of allTools) {
        if (wanted.has(t.name)) {
          out.push({
            tool: { name: t.name, description: t.description, inputSchema: t.inputSchema },
            serverId: t.serverId,
          });
        }
      }
      return out;
    },
    async callTool(serverId, name, args, _signal) {
      try {
        const r = (await mcp.callTool(serverId, name, args)) as {
          content?: unknown;
          isError?: boolean;
        };
        return { result: r, isError: !!r?.isError };
      } catch (err) {
        return {
          result: { error: err instanceof Error ? err.message : String(err) },
          isError: true,
        };
      }
    },
    recordUsage({ messageId, serverId, toolName, args, result, error }) {
      try {
        db.prepare(
          'INSERT INTO mcp_tool_usage (id, message_id, server_id, tool_name, args_json, result_json, error, created_at) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          messageId,
          serverId,
          toolName,
          JSON.stringify(args ?? {}),
          result === undefined ? null : JSON.stringify(result),
          error ?? null,
          Date.now(),
        );
      } catch {
        // never fail the loop on persistence error
      }
    },
  };
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
        attachmentIds: z.array(z.string()).default([]),
      }),
    )
    .subscription(({ input }) => {
      return observable<OrchestratorEvent, Error>(
        (observer: Observer<OrchestratorEvent, Error>): TeardownLogic => {
          const ac = new AbortController();
          const orch = getOrchestrator();

          // Auto-add @-mentioned agents to the session participants list with default persona
          ensureMentionedParticipants(input.sessionId, input.mentions);

          // Link any pending attachments to the most recent user message after turn:start.
          const linkAttachments = (userMsgId: string): void => {
            try {
              const ids = input.attachmentIds ?? [];
              if (ids.length === 0) return;
              const db = (globalThis as any).sidepad?.db;
              if (!db) return;
              const stmt = db.prepare('UPDATE attachments SET message_id = ? WHERE id = ?');
              const tx = db.transaction(() => {
                for (const id of ids) stmt.run(userMsgId, id);
              });
              tx();
            } catch {
              /* best-effort */
            }
          };

          async function run() {
            try {
              // Resolve attachment rows for the vision router. Best-effort —
              // if anything fails we just send without images and the model
              // sees the OCR'd text inlined by the renderer.
              let attachments: Array<{ filename: string; mime: string | null; storage_path: string }> = [];
              try {
                const ids = input.attachmentIds ?? [];
                if (ids.length > 0) {
                  const db = (globalThis as any).sidepad?.db;
                  if (db) {
                    const stmt = db.prepare(
                      'SELECT filename, mime, storage_path FROM attachments WHERE id = ?',
                    );
                    attachments = ids
                      .map((id: string) => stmt.get(id) as any)
                      .filter(Boolean);
                  }
                }
              } catch {
                /* best-effort */
              }
              const orchInput = { ...input, attachments };
              for await (const event of orch.send(orchInput, ac.signal)) {
                if (ac.signal.aborted) return;
                // Track the turnId from the turn:start event
                if (event.type === 'turn:start') {
                  activeTurns.set(event.turnId, ac);
                  // Best-effort: locate the user message just appended for this turn and
                  // link attachments. session-store appended it synchronously above.
                  try {
                    const db = (globalThis as any).sidepad?.db;
                    const row = db
                      ?.prepare(
                        "SELECT id FROM messages WHERE turn_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1",
                      )
                      .get(event.turnId) as { id?: string } | undefined;
                    if (row?.id) linkAttachments(row.id);
                  } catch {
                    /* ignore */
                  }
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

import type { SessionStore } from '../store/session-store';
import type { ProviderRegistry } from '../providers';
import type { ClassifierAgent } from './classifier';
import { resolveMode, type ClassifierResult } from './mode-resolver';
import { buildContext } from './context-builder';
import { truncateContext } from './truncate';
import { segmentByMentions } from './segment-mentions';
import {
  AUTO_AGENT_ID,
  estimateTier,
  pickAgentId,
  planEffort,
  type AgentCandidate,
} from './effort-planner';
import type { OrchestratorEvent } from './types';
import {
  transformMessagesForVision,
  type AttachmentLike,
} from './vision-router';
import type {
  LLMProvider,
  ChatRequest,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  ReasoningEffort,
} from '../providers/types';
import type { Session } from '../store/types';

function uuid(): string { return crypto.randomUUID(); }

const MAX_TOOL_ROUNDS = 6;
/** Roundtable discussion rounds: round 1 = positions, round 2 = reactions. */
const ROUND_TABLE_ROUNDS = 2;
/** Prior finalized messages carried into each agent's context. */
const HISTORY_MESSAGE_LIMIT = 30;
/** Per-tool-result budget before it is capped on its way back to the model. */
const MAX_TOOL_RESULT_CHARS = 8_000;

/** Cap oversized tool results so one huge output cannot blow the context. */
export function capToolResult(result: unknown): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[... truncated ${text.length - MAX_TOOL_RESULT_CHARS} chars]`;
}

export interface OrchestratorSendInput {
  sessionId: string;
  text: string;
  mentions: string[];
  /**
   * Optional list of attachments linked to this turn's user message. Used by
   * the vision router to attach raw image bytes when the active model
   * supports vision.
   */
  attachments?: AttachmentLike[];
}

export interface SessionToolResolver {
  /** Returns all enabled tools for the given session, with their owning server. */
  listToolsForSession(
    sessionId: string,
  ): Promise<Array<{ tool: ToolDefinition; serverId: string }>>;
  /** Invoke a tool by serverId + name. Returns content + error flag. */
  callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ result: unknown; isError: boolean }>;
  /** Persist a single usage row to mcp_tool_usage. */
  recordUsage(opts: {
    messageId: string;
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }): void;
}

/** A prior conversation message, kept addressable by agent for visibility filtering. */
interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
  agentId: string;
}

type FinalizableEvent = OrchestratorEvent & { __finalContent?: string };

interface AgentRunResult {
  content: string;
  errored: boolean;
}

/**
 * Run async iterables concurrently and yield their events in arrival order.
 * Each factory is invoked immediately so all underlying streams make
 * progress in parallel (parallel mode, concurrent commenters).
 */
async function* mergeAsyncGenerators<T>(
  factories: Array<() => AsyncIterable<T>>,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let active = factories.length;
  let crashed: unknown = null;

  const push = (item: T) => {
    queue.push(item);
    const n = notify;
    notify = null;
    n?.();
  };

  void Promise.all(
    factories.map(async (factory) => {
      try {
        for await (const item of factory()) push(item);
      } catch (err) {
        // runWithTools converts provider failures into error events; a throw
        // here means a bug — remember it and rethrow once drained.
        crashed = crashed ?? err;
      } finally {
        active -= 1;
        if (active === 0) {
          const n = notify;
          notify = null;
          n?.();
        }
      }
    }),
  );

  while (queue.length > 0 || active > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      continue;
    }
    yield queue.shift()!;
  }
  if (crashed) throw crashed;
}

export class ChatOrchestrator {
  constructor(
    private store: SessionStore,
    private registry: ProviderRegistry,
    private classifier: ClassifierAgent | null,
    private getProviderForAgent: (agentId: string) => LLMProvider | null = () => null,
    private getModelForAgent: (agentId: string) => string = () => 'gpt-4o-mini',
    private getPersonaPromptForAgent: (sessionId: string, agentId: string) => string | null = () => null,
    private getSessionSkillAddendum: (sessionId: string) => string = () => '',
    private toolResolver: SessionToolResolver | null = null,
    private getContextWindowForModel: (agentId: string, model: string) => number = () => 8000,
    private getAgentLabel: (agentId: string) => string = (id) => id,
  ) {}

  /**
   * Combine persona prompt + session system prompt + attached skill addenda.
   */
  private composedSystemPrompt(sessionId: string, agentId: string, sessionPrompt: string | null): string | null {
    const persona = this.getPersonaPromptForAgent(sessionId, agentId);
    const skill = this.getSessionSkillAddendum(sessionId) || '';
    const parts: string[] = [];
    if (persona) parts.push(persona);
    if (sessionPrompt) parts.push(sessionPrompt);
    if (skill.trim()) parts.push(skill);
    if (parts.length === 0) return null;
    return parts.join('\n\n');
  }

  /**
   * Finalized messages from earlier turns, so multi-agent collaboration is
   * a continuing conversation instead of a stateless single exchange.
   * Best-effort: any store failure yields an empty history.
   */
  private buildHistory(sessionId: string): HistoryItem[] {
    try {
      const msgs = this.store.listMessages(sessionId);
      const out: HistoryItem[] = [];
      for (const m of msgs) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        if (m.role === 'assistant' && m.status !== 'done') continue;
        if (!m.content || !m.content.trim()) continue;
        let agentId = 'user';
        if (m.role === 'assistant' && m.metaJson) {
          try {
            agentId = (JSON.parse(m.metaJson) as { agentId?: string }).agentId ?? 'assistant';
          } catch { /* keep fallback */ }
        }
        out.push({ role: m.role, content: m.content, agentId });
      }
      return out.slice(-HISTORY_MESSAGE_LIMIT);
    } catch {
      return [];
    }
  }

  /** History as provider messages, honoring the session visibility mode. */
  private historyMessages(history: HistoryItem[], session: Session, agentId: string): ChatMessage[] {
    const selected =
      session.visibilityMode === 'independent'
        ? history.filter((h) => h.agentId === agentId)
        : history;
    return selected.map((h) =>
      h.role === 'assistant'
        ? { role: 'assistant' as const, content: h.content, name: this.getAgentLabel(h.agentId) }
        : { role: 'user' as const, content: h.content },
    );
  }

  async *send(
    input: OrchestratorSendInput,
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const session = this.store.getSession(input.sessionId);
    if (!session) throw new Error('Session not found');

    const turnId = uuid();

    // Snapshot prior conversation before this turn's user message is appended.
    const history = this.buildHistory(input.sessionId);

    let classifierResult: ClassifierResult | undefined;
    if (this.classifier?.isEnabled() && input.mentions.length >= 2) {
      try {
        classifierResult = await this.classifier.classify({
          text: input.text,
          mentions: input.mentions.map((id) => ({ agentId: id, displayName: id, role: 'agent' })),
          triggerHints: { leadMatched: false, commentMatched: false },
        });
      } catch {
        // fall through to rules
      }
    }

    const modeResult = resolveMode(session, input.text, input.mentions, classifierResult);

    if (modeResult.mode === 'error') {
      yield {
        type: 'message:error',
        turnId,
        msgId: '',
        agentId: '',
        code: modeResult.errorCode!,
        message: 'No default agent set',
        retriable: false,
      };
      return;
    }

    let agentIds =
      modeResult.mode === 'lead-and-comment'
        ? [modeResult.leadAgentId!, ...modeResult.commenterAgentIds!]
        : modeResult.agentIds;

    // Auto model routing: the '__auto__' sentinel asks the framework to pick
    // which participant answers based on the estimated task tier.
    if (modeResult.mode === 'single' && agentIds[0] === AUTO_AGENT_ID) {
      const pick = this.routeAutoAgent(session, input.text);
      if (!pick) {
        yield {
          type: 'message:error',
          turnId,
          msgId: '',
          agentId: '',
          code: 'NO_DEFAULT_AGENT',
          message: 'Auto routing found no available agent',
          retriable: false,
        };
        return;
      }
      agentIds = [pick];
    }

    this.store.appendUserMessage(input.sessionId, turnId, input.text);

    yield { type: 'turn:start', turnId, mode: modeResult.mode };

    if (modeResult.mode === 'relay') {
      yield* this.runRelayInternal(input, turnId, session, agentIds, history, signal);
    } else if (modeResult.mode === 'lead-and-comment') {
      yield* this.runLeadAndComment(
        input,
        turnId,
        session,
        modeResult.leadAgentId!,
        modeResult.commenterAgentIds!,
        history,
        signal,
      );
    } else if (modeResult.mode === 'roundtable') {
      yield* this.runRoundtable(input, turnId, session, agentIds, history, signal);
    } else {
      yield* this.runParallel(input, turnId, session, agentIds, history, signal);
    }

    yield { type: 'turn:complete', turnId };
  }

  /**
   * Resolve enabled tools for a session and return both the ToolDefinition[]
   * for the provider and a map from tool-name → serverId for invocation.
   */
  private async resolveTools(sessionId: string): Promise<{
    tools: ToolDefinition[];
    serverByName: Map<string, string>;
  }> {
    if (!this.toolResolver) return { tools: [], serverByName: new Map() };
    try {
      const resolved = await this.toolResolver.listToolsForSession(sessionId);
      const tools: ToolDefinition[] = [];
      const serverByName = new Map<string, string>();
      for (const r of resolved) {
        tools.push(r.tool);
        serverByName.set(r.tool.name, r.serverId);
      }
      return { tools, serverByName };
    } catch {
      return { tools: [], serverByName: new Map() };
    }
  }

  /**
   * Run a per-agent provider call inside a tool-resolution loop:
   * provider → (if toolCalls) → mcp.callTool(...) → next provider round → ...
   * Bounded to MAX_TOOL_ROUNDS rounds; on exceed, emits message:error.
   *
   * Streams message:delta events; emits exactly one of:
   *   - message:finish (when the model stops with no tool calls), OR
   *   - message:error (on provider error / loop-exceeded)
   * Plus tool_call:start / tool_call:result for each tool invocation.
   */
  private async *runWithTools(
    provider: LLMProvider,
    initialReq: ChatRequest,
    eventCtx: { turnId: string; msgId: string; agentId: string; effort?: ReasoningEffort | null },
    serverByName: Map<string, string>,
    signal: AbortSignal,
  ): AsyncGenerator<FinalizableEvent> {
    const { turnId, msgId, agentId } = eventCtx;
    let req: ChatRequest = initialReq;
    let rounds = 0;
    let finalContent = '';
    let accumulatedReasoning = '';

    while (true) {
      if (rounds >= MAX_TOOL_ROUNDS) {
        const msg = `Tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`;
        this.store.markError(msgId, 'tool_loop_exceeded', msg);
        yield {
          type: 'message:error',
          turnId,
          msgId,
          agentId,
          code: 'tool_loop_exceeded',
          message: msg,
          retriable: false,
        };
        return;
      }
      rounds++;

      let roundContent = '';
      let roundToolCalls: ToolCall[] | undefined;
      let roundFinish: string | undefined;
      let roundUsage: { promptTokens: number; completionTokens: number } | undefined;

      try {
        for await (const ev of provider.chat(req, signal)) {
          if (signal.aborted) return;
          if (ev.delta) {
            roundContent += ev.delta;
            this.store.appendDelta(msgId, ev.delta);
            yield { type: 'message:delta', turnId, msgId, agentId, delta: ev.delta };
          }
          if (ev.reasoningDelta) {
            accumulatedReasoning += ev.reasoningDelta;
            yield {
              type: 'message:reasoning_delta',
              turnId,
              msgId,
              agentId,
              delta: ev.reasoningDelta,
            };
          }
          if (ev.finishReason) {
            roundFinish = ev.finishReason;
            roundUsage = ev.usage;
            roundToolCalls = ev.toolCalls;
          }
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.store.markError(msgId, 'UNKNOWN', m);
        yield {
          type: 'message:error',
          turnId,
          msgId,
          agentId,
          code: 'UNKNOWN',
          message: m,
          retriable: false,
        };
        return;
      }

      finalContent += roundContent;

      // No tool calls → done.
      if (!roundToolCalls || roundToolCalls.length === 0) {
        const finishReason = roundFinish ?? 'stop';
        if (accumulatedReasoning.length > 0) {
          try { this.store.setReasoning(msgId, accumulatedReasoning); } catch { /* non-fatal */ }
        }
        const meta: Record<string, unknown> = {};
        if (eventCtx.effort) meta.effort = eventCtx.effort;
        this.store.finalizeAssistant(msgId, meta as any, finishReason, roundUsage);
        const finishEv: FinalizableEvent = {
          type: 'message:finish',
          turnId,
          msgId,
          agentId,
          finishReason,
          usage: roundUsage,
        };
        finishEv.__finalContent = finalContent;
        yield finishEv;
        return;
      }

      // We have tool calls to run. All start events go out up front, then the
      // tools execute concurrently; results are emitted in tool-call order.
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: roundContent,
        toolCalls: roundToolCalls,
      };
      const followUpToolMsgs: ChatMessage[] = [];

      for (const tc of roundToolCalls) {
        if (signal.aborted) return;
        const serverId = serverByName.get(tc.name) ?? '';
        yield {
          type: 'tool_call:start',
          turnId,
          msgId,
          agentId,
          toolCallId: tc.id,
          serverId,
          toolName: tc.name,
          args: tc.arguments ?? {},
        };
      }

      const executed = await Promise.all(
        roundToolCalls.map(async (tc) => {
          const serverId = serverByName.get(tc.name) ?? '';
          const startedAt = Date.now();
          let resultPayload: unknown = null;
          let isError = false;
          let errorMsg: string | undefined;
          try {
            if (!this.toolResolver) throw new Error('no tool resolver configured');
            if (!serverId) throw new Error(`unknown tool: ${tc.name}`);
            const r = await this.toolResolver.callTool(
              serverId,
              tc.name,
              tc.arguments ?? {},
              signal,
            );
            resultPayload = r.result;
            isError = r.isError;
          } catch (err) {
            isError = true;
            errorMsg = err instanceof Error ? err.message : String(err);
            resultPayload = { error: errorMsg };
          }
          return { tc, serverId, startedAt, resultPayload, isError, errorMsg };
        }),
      );

      for (const r of executed) {
        const durationMs = Date.now() - r.startedAt;
        try {
          this.toolResolver?.recordUsage({
            messageId: msgId,
            serverId: r.serverId,
            toolName: r.tc.name,
            args: r.tc.arguments ?? {},
            result: r.resultPayload,
            error: r.errorMsg,
          });
        } catch {
          // never fail the loop on persistence error
        }
        yield {
          type: 'tool_call:result',
          turnId,
          msgId,
          agentId,
          toolCallId: r.tc.id,
          result: r.resultPayload,
          isError: r.isError,
          durationMs,
        };
        followUpToolMsgs.push({
          role: 'tool',
          toolCallId: r.tc.id,
          content: capToolResult(r.resultPayload),
        });
      }

      // Build next-round request: previous messages + assistant + tool results
      req = {
        ...req,
        messages: [...req.messages, assistantMsg, ...followUpToolMsgs],
      };
      // loop.
    }
  }

  /**
   * Auto routing: estimate the task tier and pick the participant whose
   * capabilities best match (deep → reasoning-capable, light → cheap/fast).
   */
  private routeAutoAgent(session: Session, text: string): string | null {
    const tier = estimateTier(text);
    const candidates: AgentCandidate[] = [];
    for (const p of session.participants) {
      const provider = this.getProviderForAgent(p.agentId);
      if (!provider) continue;
      const model = this.getModelForAgent(p.agentId);
      candidates.push({ agentId: p.agentId, model, caps: provider.capabilities?.(model) });
    }
    return pickAgentId(candidates, tier);
  }

  /**
   * One agent's answer inside a turn: opens the persisted assistant message,
   * applies the vision router, streams through the tool loop. Yields events;
   * the final finish event carries __finalContent for sequential runners.
   */
  private async *runAgent(opts: {
    input: OrchestratorSendInput;
    turnId: string;
    session: Session;
    agentId: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    serverByName: Map<string, string>;
    signal: AbortSignal;
  }): AsyncGenerator<FinalizableEvent> {
    const { input, turnId, session, agentId, messages, tools, serverByName, signal } = opts;
    const provider = this.getProviderForAgent(agentId);
    const model = this.getModelForAgent(agentId);
    const msg = this.store.startAssistantMessage(session.id, turnId, agentId, provider?.id ?? 'unknown', model);

    if (!provider) {
      this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${agentId}`);
      yield {
        type: 'message:error',
        turnId,
        msgId: msg.id,
        agentId,
        code: 'PROVIDER_NOT_CONFIGURED',
        message: `No provider for agent ${agentId}`,
        retriable: false,
      };
      return;
    }

    // Effort planning: capability-aware reasoning tier for this call
    // (null = keep provider default). Recorded in message meta for audit.
    const effort = planEffort(input.text, provider.capabilities?.(model));

    const req: ChatRequest = {
      model,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
    };
    req.messages = transformMessagesForVision(req.messages, input.attachments ?? [], provider, model);
    yield* this.runWithTools(provider, req, { turnId, msgId: msg.id, agentId, effort }, serverByName, signal);
  }

  /**
   * Run one agent to completion, streaming every public event through
   * (delegating generator), and returning its final content plus whether
   * it errored. Call with `yield*` to forward events live.
   */
  private async *runAgentSequential(
    opts: Parameters<ChatOrchestrator['runAgent']>[0],
  ): AsyncGenerator<OrchestratorEvent, AgentRunResult, unknown> {
    let content = '';
    let errored = false;
    for await (const ev of this.runAgent(opts)) {
      if ((ev as FinalizableEvent).__finalContent !== undefined) {
        content = (ev as FinalizableEvent).__finalContent!;
      }
      const { __finalContent: _drop, ...clean } = ev as FinalizableEvent;
      void _drop;
      yield clean;
      if (clean.type === 'message:error') errored = true;
    }
    return { content, errored };
  }

  /** Apply the model's token budget (CJK-aware estimate, drop-oldest). */
  private applyBudget(session: Session, agentId: string, messages: ChatMessage[]): ChatMessage[] {
    const model = this.getModelForAgent(agentId);
    const window = this.getContextWindowForModel(agentId, model);
    const { messages: truncated } = truncateContext(messages, window * 0.85, window);
    return truncated;
  }

  /** System prompt + history + one user message, for hand-rolled runners. */
  private buildMessages(
    session: Session,
    agentId: string,
    history: HistoryItem[],
    userContent: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const sysPrompt = this.composedSystemPrompt(session.id, agentId, session.systemPrompt);
    if (sysPrompt) messages.push({ role: 'system', content: sysPrompt });
    messages.push(...this.historyMessages(history, session, agentId));
    messages.push({ role: 'user', content: userContent });
    // Relay/roundtable transcripts grow unboundedly without this.
    return this.applyBudget(session, agentId, messages);
  }

  /** Standard buildContext path (adds CJK-aware truncation). */
  private buildAgentContext(
    session: Session,
    agentId: string,
    input: OrchestratorSendInput,
    history: HistoryItem[],
  ): ChatMessage[] {
    const model = this.getModelForAgent(agentId);
    const ctx = buildContext({
      history: history.map((h) => ({ role: h.role, content: h.content, agentId: h.agentId })),
      agentId,
      visibilityMode: session.visibilityMode,
      systemPrompt: this.composedSystemPrompt(session.id, agentId, session.systemPrompt),
      currentTurn: [{ role: 'user' as const, content: input.text }],
      modelContextWindow: this.getContextWindowForModel(agentId, model),
    });
    return ctx.messages;
  }

  private async *runParallel(
    input: OrchestratorSendInput,
    turnId: string,
    session: Session,
    agentIds: string[],
    history: HistoryItem[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    // All agents stream concurrently; events interleave in arrival order.
    const runs = agentIds.map(
      (agentId) => (): AsyncIterable<FinalizableEvent> =>
        this.runAgent({
          input,
          turnId,
          session,
          agentId,
          messages: this.buildAgentContext(session, agentId, input, history),
          tools,
          serverByName,
          signal,
        }),
    );
    for await (const ev of mergeAsyncGenerators(runs)) {
      const { __finalContent: _drop, ...clean } = ev as FinalizableEvent;
      void _drop;
      yield clean;
    }
  }

  private async *runLeadAndComment(
    input: OrchestratorSendInput,
    turnId: string,
    session: Session,
    leadId: string,
    commenterIds: string[],
    history: HistoryItem[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    // Phase 1: Lead answers (sequential — commenters need its output).
    const leadMessages = this.buildMessages(session, leadId, history, input.text);
    const { content: leadContent } = yield* this.runAgentSequential({
      input,
      turnId,
      session,
      agentId: leadId,
      messages: leadMessages,
      tools,
      serverByName,
      signal,
    });

    // Phase 2: commenters read the lead's answer and critique — concurrently,
    // since they only depend on the lead, not on each other.
    const commenterRuns = commenterIds.map(
      (commenterId) => (): AsyncIterable<FinalizableEvent> => {
        const ctxMessages: ChatMessage[] = [];
        const sysPrompt = this.composedSystemPrompt(session.id, commenterId, session.systemPrompt);
        if (sysPrompt) ctxMessages.push({ role: 'system', content: sysPrompt });
        ctxMessages.push(...this.historyMessages(history, session, commenterId));
        ctxMessages.push({ role: 'user', content: input.text });
        ctxMessages.push({ role: 'assistant', content: leadContent, name: this.getAgentLabel(leadId) });
        return this.runAgent({
          input,
          turnId,
          session,
          agentId: commenterId,
          messages: this.applyBudget(session, commenterId, ctxMessages),
          tools,
          serverByName,
          signal,
        });
      },
    );
    for await (const ev of mergeAsyncGenerators(commenterRuns)) {
      const { __finalContent: _drop, ...clean } = ev as FinalizableEvent;
      void _drop;
      yield clean;
    }
  }

  /**
   * Roundtable: every mentioned agent weighs in as a peer. Within a round,
   * agents answer in order, each seeing everything said before them; a
   * second round lets them react to each other (agree / challenge / refine).
   */
  private async *runRoundtable(
    input: OrchestratorSendInput,
    turnId: string,
    session: Session,
    agentIds: string[],
    history: HistoryItem[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    const transcript: Array<{ label: string; content: string }> = [];

    for (let round = 1; round <= ROUND_TABLE_ROUNDS; round++) {
      for (const agentId of agentIds) {
        if (signal.aborted) return;

        const pieces: string[] = [`[Roundtable · round ${round}/${ROUND_TABLE_ROUNDS}]`, input.text];
        if (transcript.length > 0) {
          pieces.push('---', 'Discussion so far:');
          for (const t of transcript) pieces.push(`${t.label}: ${t.content}`);
        }
        pieces.push(
          round === 1
            ? 'Share your own view on the question. Be substantive and concise.'
            : 'Respond to the other participants: agree, challenge, or refine their points. Be concise; do not just repeat your earlier answer.',
        );
        const userContent = pieces.join('\n\n');

        const { content, errored } = yield* this.runAgentSequential({
          input,
          turnId,
          session,
          agentId,
          messages: this.buildMessages(session, agentId, history, userContent),
          tools,
          serverByName,
          signal,
        });
        if (!errored && content.trim()) {
          transcript.push({ label: this.getAgentLabel(agentId), content });
        }
      }
    }
  }

  /**
   * Directed sequential relay: each agent owns the @-segment addressed to it,
   * sees prior agents' replies inlined, and hands its reply to the next.
   * The chain stops on the first agent error.
   */
  private async *runRelayInternal(
    input: OrchestratorSendInput,
    turnId: string,
    session: Session,
    agentIds: string[],
    history: HistoryItem[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    const { prefix, parts } = segmentByMentions(input.text, agentIds);

    // Defensive fallback: no mention boundaries found → treat the whole text
    // as a single segment for agentIds[0]. This shouldn't normally happen
    // because mode-resolver only routes to relay when mentions ≥ 2.
    const effectiveParts = parts.length > 0
      ? parts
      : agentIds.map((id) => ({ agentId: id, segment: input.text }));
    const effectivePrefix = parts.length > 0 ? prefix : '';

    const replies: string[] = [];

    for (let i = 0; i < effectiveParts.length; i++) {
      const agentId = effectiveParts[i].agentId;

      // Compose cumulative user content: prefix + own segment + prior replies.
      const pieces: string[] = [];
      if (effectivePrefix.trim()) pieces.push(effectivePrefix.trim());
      for (let j = 0; j <= i; j++) {
        pieces.push(effectiveParts[j].segment);
        if (j < i) pieces.push(`${this.getAgentLabel(effectiveParts[j].agentId)}: ${replies[j]}`);
      }
      const userContent = pieces.join('\n\n');

      const { content, errored } = yield* this.runAgentSequential({
        input,
        turnId,
        session,
        agentId,
        messages: this.buildMessages(session, agentId, history, userContent),
        tools,
        serverByName,
        signal,
      });
      if (errored) return; // stop the chain on agent error
      replies.push(content);
    }
  }
}

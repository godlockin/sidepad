import type { SessionStore } from '../store/session-store';
import type { ProviderRegistry } from '../providers';
import type { ClassifierAgent } from './classifier';
import { resolveMode, type ClassifierResult } from './mode-resolver';
import { buildContext } from './context-builder';
import { segmentByMentions } from './segment-mentions';
import type { OrchestratorEvent } from './types';
import type {
  LLMProvider,
  ChatRequest,
  ChatMessage,
  ToolDefinition,
  ToolCall,
} from '../providers/types';

function uuid(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }

const MAX_TOOL_ROUNDS = 6;

export interface OrchestratorSendInput {
  sessionId: string;
  text: string;
  mentions: string[];
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

  async *send(
    input: OrchestratorSendInput,
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const session = this.store.getSession(input.sessionId);
    if (!session) throw new Error('Session not found');

    const turnId = uuid();

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

    this.store.appendUserMessage(input.sessionId, turnId, input.text);

    yield { type: 'turn:start', turnId, mode: modeResult.mode };

    const agentIds =
      modeResult.mode === 'lead-and-comment'
        ? [modeResult.leadAgentId!, ...modeResult.commenterAgentIds!]
        : modeResult.agentIds;

    if (modeResult.mode === 'relay') {
      yield* this.runRelayInternal(input, turnId, session, agentIds, signal);
    } else if (modeResult.mode === 'lead-and-comment') {
      yield* this.runLeadAndComment(
        input,
        turnId,
        session,
        modeResult.leadAgentId!,
        modeResult.commenterAgentIds!,
        signal,
      );
    } else {
      yield* this.runParallel(input, turnId, session, agentIds, signal);
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
    eventCtx: { turnId: string; msgId: string; agentId: string },
    serverByName: Map<string, string>,
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent & { __finalContent?: string }> {
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
        this.store.finalizeAssistant(msgId, {} as any, finishReason, roundUsage);
        const finishEv: OrchestratorEvent & { __finalContent?: string } = {
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

      // We have tool calls to run. Append the assistant message + tool results
      // to the next request.
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
        const durationMs = Date.now() - startedAt;
        try {
          this.toolResolver?.recordUsage({
            messageId: msgId,
            serverId,
            toolName: tc.name,
            args: tc.arguments ?? {},
            result: resultPayload,
            error: errorMsg,
          });
        } catch {
          // never fail the loop on persistence error
        }
        yield {
          type: 'tool_call:result',
          turnId,
          msgId,
          agentId,
          toolCallId: tc.id,
          result: resultPayload,
          isError,
          durationMs,
        };
        followUpToolMsgs.push({
          role: 'tool',
          toolCallId: tc.id,
          content: typeof resultPayload === 'string' ? resultPayload : JSON.stringify(resultPayload),
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

  private async *runParallel(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    agentIds: string[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    for (const agentId of agentIds) {
      const provider = this.getProviderForAgent(agentId);
      const model = this.getModelForAgent(agentId);
      const msg = this.store.startAssistantMessage(session.id, turnId, agentId, provider?.id ?? 'unknown', model);

      if (!provider) {
        this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${agentId}`);
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'PROVIDER_NOT_CONFIGURED', message: `No provider for agent ${agentId}`, retriable: false };
        continue;
      }

      const ctx = buildContext({
        history: [],
        agentId,
        visibilityMode: session.visibilityMode,
        systemPrompt: this.composedSystemPrompt(session.id, agentId, session.systemPrompt),
        currentTurn: [{ role: 'user' as const, content: input.text }],
        modelContextWindow: 8000,
      });
      ctx.model = model;
      if (tools.length) ctx.tools = tools;

      for await (const ev of this.runWithTools(provider, ctx, { turnId, msgId: msg.id, agentId }, serverByName, signal)) {
        // strip private __finalContent before forwarding
        const { __finalContent: _drop, ...clean } = ev as any;
        void _drop;
        yield clean as OrchestratorEvent;
      }
    }
  }

  private async *runLeadAndComment(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    leadId: string,
    commenterIds: string[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    // Phase 1: Lead
    const leadProvider = this.getProviderForAgent(leadId);
    const leadModel = this.getModelForAgent(leadId);
    const leadMsg = this.store.startAssistantMessage(session.id, turnId, leadId, leadProvider?.id ?? 'unknown', leadModel);
    let leadContent = '';

    if (leadProvider) {
      const ctx = buildContext({
        history: [],
        agentId: leadId,
        visibilityMode: session.visibilityMode,
        systemPrompt: this.composedSystemPrompt(session.id, leadId, session.systemPrompt),
        currentTurn: [{ role: 'user' as const, content: input.text }],
        modelContextWindow: 8000,
      });
      ctx.model = leadModel;
      if (tools.length) ctx.tools = tools;
      for await (const ev of this.runWithTools(leadProvider, ctx, { turnId, msgId: leadMsg.id, agentId: leadId }, serverByName, signal)) {
        if ((ev as any).__finalContent !== undefined) leadContent = (ev as any).__finalContent;
        const { __finalContent: _drop, ...clean } = ev as any;
        void _drop;
        yield clean as OrchestratorEvent;
      }
    } else {
      this.store.markError(leadMsg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${leadId}`);
      yield { type: 'message:error', turnId, msgId: leadMsg.id, agentId: leadId, code: 'PROVIDER_NOT_CONFIGURED', message: `No provider for agent ${leadId}`, retriable: false };
    }

    // Phase 2: commenters see lead's content
    for (const commenterId of commenterIds) {
      const commenterProvider = this.getProviderForAgent(commenterId);
      const commenterModel = this.getModelForAgent(commenterId);
      const cmsg = this.store.startAssistantMessage(session.id, turnId, commenterId, commenterProvider?.id ?? 'unknown', commenterModel);

      if (!commenterProvider) {
        this.store.markError(cmsg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${commenterId}`);
        yield { type: 'message:error', turnId, msgId: cmsg.id, agentId: commenterId, code: 'PROVIDER_NOT_CONFIGURED', message: `No provider for agent ${commenterId}`, retriable: false };
        continue;
      }

      const ctxMessages: ChatMessage[] = [];
      const sysPrompt = this.composedSystemPrompt(session.id, commenterId, session.systemPrompt);
      if (sysPrompt) ctxMessages.push({ role: 'system', content: sysPrompt });
      ctxMessages.push({ role: 'user', content: input.text });
      ctxMessages.push({ role: 'assistant', content: leadContent, name: leadId });

      const req: ChatRequest = { model: commenterModel, messages: ctxMessages, ...(tools.length ? { tools } : {}) };
      for await (const ev of this.runWithTools(commenterProvider, req, { turnId, msgId: cmsg.id, agentId: commenterId }, serverByName, signal)) {
        const { __finalContent: _drop, ...clean } = ev as any;
        void _drop;
        yield clean as OrchestratorEvent;
      }
    }
  }

  private async *runRelayInternal(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    agentIds: string[],
    signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const { tools, serverByName } = await this.resolveTools(session.id);

    // Directed sequential relay: segment by @<agent> boundaries; each agent
    // sees the prefix + its own segment + all prior segments with prior
    // replies inlined as plain text (NOT as separate assistant messages).
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
      const provider = this.getProviderForAgent(agentId);
      const model = this.getModelForAgent(agentId);

      if (!provider) {
        const msg = this.store.startAssistantMessage(session.id, turnId, agentId, 'unknown', model);
        this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `Provider not found for agent ${agentId}`);
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'PROVIDER_NOT_CONFIGURED', message: 'Provider not found', retriable: false };
        // Stop the chain — subsequent agents don't run.
        return;
      }

      const msg = this.store.startAssistantMessage(session.id, turnId, agentId, provider.id, model);

      // Compose cumulative user content.
      const pieces: string[] = [];
      if (effectivePrefix.trim()) pieces.push(effectivePrefix.trim());
      for (let j = 0; j <= i; j++) {
        pieces.push(effectiveParts[j].segment);
        if (j < i) pieces.push(`@${effectiveParts[j].agentId}: ${replies[j]}`);
      }
      const userContent = pieces.join('\n\n');

      const ctxMessages: ChatMessage[] = [];
      const sysPrompt = this.composedSystemPrompt(session.id, agentId, session.systemPrompt);
      if (sysPrompt) ctxMessages.push({ role: 'system', content: sysPrompt });
      ctxMessages.push({ role: 'user', content: userContent });

      const req: ChatRequest = { model, messages: ctxMessages, ...(tools.length ? { tools } : {}) };
      let agentContent = '';
      let errored = false;
      for await (const ev of this.runWithTools(provider, req, { turnId, msgId: msg.id, agentId }, serverByName, signal)) {
        if ((ev as any).__finalContent !== undefined) agentContent = (ev as any).__finalContent;
        const { __finalContent: _drop, ...clean } = ev as any;
        void _drop;
        yield clean as OrchestratorEvent;
        if (clean.type === 'message:error') errored = true;
      }
      if (errored) return; // stop the chain on agent error
      replies.push(agentContent);
    }
  }
}

import type { SessionStore } from '../store/session-store';
import type { ProviderRegistry } from '../providers';
import type { ClassifierAgent } from './classifier';
import { resolveMode, type ClassifierResult, type ModeResult } from './mode-resolver';
import { buildContext } from './context-builder';
import type { OrchestratorEvent } from './types';
import type { LLMProvider } from '../providers/types';

function uuid(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }

export interface OrchestratorSendInput {
  sessionId: string;
  text: string;
  mentions: string[];
}

export class ChatOrchestrator {
  constructor(
    private store: SessionStore,
    private registry: ProviderRegistry,
    private classifier: ClassifierAgent | null,
    private getProviderForAgent: (agentId: string) => LLMProvider | null = () => null,
    private getModelForAgent: (agentId: string) => string = () => 'gpt-4o-mini',
  ) {}

  async *send(
    input: OrchestratorSendInput,
    _signal: AbortSignal,
  ): AsyncIterable<OrchestratorEvent> {
    const session = this.store.getSession(input.sessionId);
    if (!session) throw new Error('Session not found');

    const turnId = uuid();

    // Resolve mode
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

    // Append user message
    this.store.appendUserMessage(input.sessionId, turnId, input.text);

    yield { type: 'turn:start', turnId, mode: modeResult.mode };

    const agentIds =
      modeResult.mode === 'lead-and-comment'
        ? [modeResult.leadAgentId!, ...modeResult.commenterAgentIds!]
        : modeResult.agentIds;

    // Route by mode
    if (modeResult.mode === 'relay') {
      yield* this.runRelayInternal(input, turnId, session, agentIds);
    } else if (modeResult.mode === 'lead-and-comment') {
      yield* this.runLeadAndComment(input, turnId, session, modeResult.leadAgentId!, modeResult.commenterAgentIds!);
    } else {
      // single or parallel
      yield* this.runParallel(input, turnId, session, agentIds);
    }

    yield { type: 'turn:complete', turnId };
  }

  private async *runParallel(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    agentIds: string[],
  ): AsyncIterable<OrchestratorEvent> {
    for (const agentId of agentIds) {
      const provider = this.getProviderForAgent(agentId);
      const model = this.getModelForAgent(agentId);
      const msg = this.store.startAssistantMessage(session.id, turnId, agentId, provider?.id ?? 'unknown', model);

      if (!provider) {
        this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${agentId}`);
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'PROVIDER_NOT_CONFIGURED', message: `No provider for agent ${agentId}`, retriable: false };
        continue;
      }

      try {
        const ctx = buildContext({
          history: [],
          agentId,
          visibilityMode: session.visibilityMode,
          systemPrompt: session.systemPrompt,
          currentTurn: [{ role: 'user' as const, content: input.text }],
          modelContextWindow: 8000,
        });
        for await (const ev of provider.chat(ctx, new AbortController().signal)) {
          if (ev.delta) {
            this.store.appendDelta(msg.id, ev.delta);
            yield { type: 'message:delta', turnId, msgId: msg.id, agentId, delta: ev.delta };
          }
          if (ev.finishReason) {
            this.store.finalizeAssistant(msg.id, {} as any, ev.finishReason, ev.usage);
            yield { type: 'message:finish', turnId, msgId: msg.id, agentId, finishReason: ev.finishReason, usage: ev.usage };
          }
        }
      } catch (err) {
        this.store.markError(msg.id, 'UNKNOWN', err instanceof Error ? err.message : String(err));
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err), retriable: false };
      }
    }
  }

  private async *runLeadAndComment(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    leadId: string,
    commenterIds: string[],
  ): AsyncIterable<OrchestratorEvent> {
    // Phase 1: Lead streams
    const leadProvider = this.getProviderForAgent(leadId);
    const leadModel = this.getModelForAgent(leadId);
    const leadMsg = this.store.startAssistantMessage(session.id, turnId, leadId, leadProvider?.id ?? 'unknown', leadModel);
    let leadContent = '';

    if (leadProvider) {
      try {
        const ctx = buildContext({
          history: [],
          agentId: leadId,
          visibilityMode: session.visibilityMode,
          systemPrompt: session.systemPrompt,
          currentTurn: [{ role: 'user' as const, content: input.text }],
          modelContextWindow: 8000,
        });
        for await (const ev of leadProvider.chat(ctx, new AbortController().signal)) {
          if (ev.delta) {
            leadContent += ev.delta;
            this.store.appendDelta(leadMsg.id, ev.delta);
            yield { type: 'message:delta', turnId, msgId: leadMsg.id, agentId: leadId, delta: ev.delta };
          }
        }
        this.store.finalizeAssistant(leadMsg.id, {} as any, 'stop');
      } catch (err) {
        this.store.markError(leadMsg.id, 'UNKNOWN', err instanceof Error ? err.message : String(err));
      }
    } else {
      this.store.markError(leadMsg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${leadId}`);
    }

    yield { type: 'message:finish', turnId, msgId: leadMsg.id, agentId: leadId, finishReason: 'stop' };

    // Phase 2: Commenters stream with lead content
    for (const commenterId of commenterIds) {
      const commenterProvider = this.getProviderForAgent(commenterId);
      const commenterModel = this.getModelForAgent(commenterId);
      const msg = this.store.startAssistantMessage(session.id, turnId, commenterId, commenterProvider?.id ?? 'unknown', commenterModel);

      if (!commenterProvider) {
        this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `No provider for agent ${commenterId}`);
        yield { type: 'message:error', turnId, msgId: msg.id, agentId: commenterId, code: 'PROVIDER_NOT_CONFIGURED', message: `No provider for agent ${commenterId}`, retriable: false };
        continue;
      }

      const ctxMessages = [
        { role: 'user' as const, content: input.text },
        { role: 'assistant' as const, content: leadContent, name: leadId },
      ];

      try {
        for await (const ev of commenterProvider.chat(
          { model: commenterModel, messages: ctxMessages },
          new AbortController().signal,
        )) {
          if (ev.delta) {
            this.store.appendDelta(msg.id, ev.delta);
            yield { type: 'message:delta', turnId, msgId: msg.id, agentId: commenterId, delta: ev.delta };
          }
          if (ev.finishReason) {
            this.store.finalizeAssistant(msg.id, {} as any, ev.finishReason, ev.usage);
            yield { type: 'message:finish', turnId, msgId: msg.id, agentId: commenterId, finishReason: ev.finishReason, usage: ev.usage };
          }
        }
      } catch (err) {
        this.store.markError(msg.id, 'UNKNOWN', err instanceof Error ? err.message : String(err));
        yield { type: 'message:error', turnId, msgId: msg.id, agentId: commenterId, code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err), retriable: false };
      }
    }
  }

  private async *runRelayInternal(
    input: OrchestratorSendInput,
    turnId: string,
    session: NonNullable<ReturnType<SessionStore['getSession']>>,
    agentIds: string[],
  ): AsyncIterable<OrchestratorEvent> {
    const successfulOutputs = new Map<string, string>();

    for (const agentId of agentIds) {
      const provider = this.getProviderForAgent(agentId);
      const model = this.getModelForAgent(agentId);

      if (!provider) {
        const msg = this.store.startAssistantMessage(session.id, turnId, agentId, 'unknown', model);
        this.store.markError(msg.id, 'PROVIDER_NOT_CONFIGURED', `Provider not found for agent ${agentId}`);
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'PROVIDER_NOT_CONFIGURED', message: 'Provider not found', retriable: false };
        continue;
      }

      const msg = this.store.startAssistantMessage(session.id, turnId, agentId, provider.id, model);

      const ctxMessages: any[] = [];
      if (session.systemPrompt) ctxMessages.push({ role: 'system', content: session.systemPrompt });
      for (const [prevAgent, output] of successfulOutputs) {
        ctxMessages.push({ role: 'assistant', content: output, name: prevAgent });
      }
      ctxMessages.push({ role: 'user', content: input.text });

      let content = '';
      try {
        for await (const ev of provider.chat({ model, messages: ctxMessages }, new AbortController().signal)) {
          if (ev.delta) {
            content += ev.delta;
            this.store.appendDelta(msg.id, ev.delta);
            yield { type: 'message:delta', turnId, msgId: msg.id, agentId, delta: ev.delta };
          }
          if (ev.finishReason) {
            this.store.finalizeAssistant(msg.id, {} as any, ev.finishReason, ev.usage);
            successfulOutputs.set(agentId, content);
            yield { type: 'message:finish', turnId, msgId: msg.id, agentId, finishReason: ev.finishReason, usage: ev.usage };
          }
        }
      } catch (err) {
        this.store.markError(msg.id, 'UNKNOWN', err instanceof Error ? err.message : String(err));
        yield { type: 'message:error', turnId, msgId: msg.id, agentId, code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err), retriable: false };
        continue; // skip, don't add to successfulOutputs
      }
    }
  }
}

import { describe, it, expect, vi } from 'vitest';
import {
  estimateTier,
  planEffort,
  pickAgentId,
  AUTO_AGENT_ID,
  type AgentCandidate,
} from '../../../src/main/orchestrator/effort-planner';
import { openaiReasoningParams } from '../../../src/main/providers/openai';
import { anthropicThinkingParams } from '../../../src/main/providers/anthropic';
import { ChatOrchestrator } from '../../../src/main/orchestrator';
import type { OrchestratorEvent } from '../../../src/main/orchestrator/types';
import type { SessionStore } from '../../../src/main/store/session-store';
import type { ProviderRegistry } from '../../../src/main/providers';
import type { LLMProvider, ChatRequest, ChatChunk } from '../../../src/main/providers/types';
import type { Session } from '../../../src/main/store/types';

// ── Task tier estimation ──────────────────────────────────────────

describe('estimateTier', () => {
  it('classifies greetings and pure arithmetic as light', () => {
    expect(estimateTier('Hi')).toBe('light');
    expect(estimateTier('谢谢！')).toBe('light');
    expect(estimateTier('12 + 34 * 2 = ?')).toBe('light');
  });
  it('classifies deep signals as deep', () => {
    expect(estimateTier('为什么 GPU 比CPU快？')).toBe('deep');
    expect(estimateTier('analyze the trade-offs of these two designs')).toBe('deep');
    expect(estimateTier('帮我调试这个 bug 的 root cause')).toBe('deep');
    expect(estimateTier(`\`\`\`ts\nconst x = 1;\n\`\`\``)).toBe('deep');
  });
  it('long text counts as deep', () => {
    expect(estimateTier('x'.repeat(1300))).toBe('deep');
  });
  it('normal questions are standard', () => {
    expect(estimateTier('今天天气怎么样')).toBe('standard');
    expect(estimateTier('what is the capital of France?')).toBe('standard');
  });
});

// ── Effort planning ───────────────────────────────────────────────

describe('planEffort', () => {
  it('never injects into non-reasoning models', () => {
    expect(planEffort('为什么天是蓝的', { reasoning: false })).toBeNull();
    expect(planEffort('为什么天是蓝的', undefined)).toBeNull();
  });
  it('light turns on reasoning models → minimal (cost save)', () => {
    expect(planEffort('Hi', { reasoning: true })).toBe('minimal');
  });
  it('deep turns on reasoning models → high (quality)', () => {
    expect(planEffort('逐步推导这个证明', { reasoning: true })).toBe('high');
  });
  it('standard turns keep the provider default', () => {
    expect(planEffort('今天天气怎么样', { reasoning: true })).toBeNull();
  });
});

// ── Auto model routing ────────────────────────────────────────────

describe('pickAgentId', () => {
  const a: AgentCandidate = { agentId: 'cheap', model: 'm', caps: {} };
  const b: AgentCandidate = { agentId: 'thinker', model: 'm', caps: { reasoning: true } };
  const c: AgentCandidate = { agentId: 'plain', model: 'm' };

  it('deep turns prefer the reasoning-capable candidate', () => {
    expect(pickAgentId([a, b, c], 'deep')).toBe('thinker');
  });
  it('light turns prefer cheap/fast or non-reasoning candidates', () => {
    expect(pickAgentId([b, a, c], 'light')).toBe('cheap');
  });
  it('light turns fall back to first when nothing is cheap', () => {
    expect(pickAgentId([b, b], 'light')).toBe('thinker');
  });
  it('standard turns take the first candidate (session order)', () => {
    expect(pickAgentId([b, a], 'standard')).toBe('thinker');
  });
  it('empty candidates → null', () => {
    expect(pickAgentId([], 'deep')).toBeNull();
  });
  it('sentinel id is a string constant', () => {
    expect(AUTO_AGENT_ID).toBe('__auto__');
  });
});

// ── Provider parameter translation ────────────────────────────────

describe('openaiReasoningParams', () => {
  it('passes effort for o-series models', () => {
    expect(openaiReasoningParams({ model: 'o3-mini', messages: [], reasoningEffort: 'high' }))
      .toEqual({ reasoning_effort: 'high' });
  });
  it('maps minimal → low on o-series, minimal on gpt-5', () => {
    expect(openaiReasoningParams({ model: 'o3', messages: [], reasoningEffort: 'minimal' }))
      .toEqual({ reasoning_effort: 'low' });
    expect(openaiReasoningParams({ model: 'gpt-5', messages: [], reasoningEffort: 'minimal' }))
      .toEqual({ reasoning_effort: 'minimal' });
  });
  it('never injects into non-reasoning chat models', () => {
    expect(openaiReasoningParams({ model: 'gpt-4o', messages: [], reasoningEffort: 'high' })).toEqual({});
    expect(openaiReasoningParams({ model: 'gpt-4o', messages: [] })).toEqual({});
  });
});

describe('anthropicThinkingParams', () => {
  it('maps effort tiers to budgets on thinking-capable models', () => {
    expect(anthropicThinkingParams({ model: 'claude-sonnet-4-5', messages: [], reasoningEffort: 'high' }))
      .toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(anthropicThinkingParams({ model: 'claude-opus-4', messages: [], reasoningEffort: 'low' }))
      .toEqual({ type: 'enabled', budget_tokens: 2048 });
  });
  it('keeps the historical 4096 default when no effort requested', () => {
    expect(anthropicThinkingParams({ model: 'claude-sonnet-4-5', messages: [] }))
      .toEqual({ type: 'enabled', budget_tokens: 4096 });
  });
  it('minimal disables thinking entirely', () => {
    expect(anthropicThinkingParams({ model: 'claude-sonnet-4-5', messages: [], reasoningEffort: 'minimal' }))
      .toBeNull();
  });
  it('returns null for models without extended thinking', () => {
    expect(anthropicThinkingParams({ model: 'claude-3-5-haiku', messages: [], reasoningEffort: 'high' }))
      .toBeNull();
  });
});

// ── Orchestrator wiring ───────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1', title: 'T', createdAt: 1, updatedAt: 1, systemPrompt: null,
    visibilityMode: 'full', groupMode: 'auto', defaultAgentId: AUTO_AGENT_ID,
    participants: [
      { agentId: 'agent-fast', personaId: '_default' },
      { agentId: 'agent-think', personaId: '_default' },
    ],
    folderId: null, projectId: null, pinned: false, archived: false,
    parentMessageId: null, iconKind: null, iconValue: null,
    ...overrides,
  };
}

function makeStore(session: Session): SessionStore {
  return {
    getSession: vi.fn((id: string) => (id === session.id ? session : null)),
    appendUserMessage: vi.fn(() => ({ id: 'u1' })),
    startAssistantMessage: vi.fn(() => ({ id: 'm1', role: 'assistant', status: 'streaming' })),
    appendDelta: vi.fn(),
    finalizeAssistant: vi.fn(),
    markError: vi.fn(),
    listMessages: vi.fn(() => []),
  } as unknown as SessionStore;
}

function makeRegistry(providers: LLMProvider[]): ProviderRegistry {
  return {
    list: vi.fn(() => providers),
    get: vi.fn((id: string) => providers.find((p) => p.id === id)!),
    has: vi.fn((id: string) => providers.some((p) => p.id === id)),
  } as unknown as ProviderRegistry;
}

function stubProvider(id: string, model: string, caps: { reasoning?: boolean }) {
  const requests: ChatRequest[] = [];
  const provider: LLMProvider = {
    id,
    configId: id,
    listModels: vi.fn(async () => []),
    capabilities: () => caps,
    async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
      requests.push(req);
      yield { delta: 'ok', finishReason: 'stop' } as ChatChunk;
    },
  };
  return { provider, requests };
}

async function collectEvents(gen: AsyncIterable<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe('orchestrator auto effort + routing', () => {
  it('auto sentinel routes light turns to the fast model and skips thinking', async () => {
    const session = makeSession();
    const fast = stubProvider('prov-fast', 'fast-model', { reasoning: false });
    const think = stubProvider('prov-think', 'think-model', { reasoning: true });
    const orch = new ChatOrchestrator(
      makeStore(session), makeRegistry([fast.provider, think.provider]), null,
      (id) => (id === 'agent-fast' ? fast.provider : id === 'agent-think' ? think.provider : null),
      (id) => (id === 'agent-fast' ? 'fast-model' : 'think-model'),
    );
    const events = await collectEvents(
      orch.send({ sessionId: 's1', text: 'Hi', mentions: [] }, new AbortController().signal),
    );
    // Light turn → fast candidate picked, no reasoning effort injected.
    expect(fast.requests).toHaveLength(1);
    expect(think.requests).toHaveLength(0);
    expect(fast.requests[0].reasoningEffort).toBeUndefined();
    expect(events.some((e) => e.type === 'turn:complete')).toBe(true);
  });

  it('auto sentinel routes deep turns to the reasoning model with high effort', async () => {
    const session = makeSession();
    const fast = stubProvider('prov-fast', 'fast-model', { reasoning: false });
    const think = stubProvider('prov-think', 'think-model', { reasoning: true });
    const orch = new ChatOrchestrator(
      makeStore(session), makeRegistry([fast.provider, think.provider]), null,
      (id) => (id === 'agent-fast' ? fast.provider : id === 'agent-think' ? think.provider : null),
      (id) => (id === 'agent-fast' ? 'fast-model' : 'think-model'),
    );
    await collectEvents(
      orch.send(
        { sessionId: 's1', text: '请逐步推导并证明这个定理', mentions: [] },
        new AbortController().signal,
      ),
    );
    expect(think.requests).toHaveLength(1);
    expect(fast.requests).toHaveLength(0);
    expect(think.requests[0].reasoningEffort).toBe('high');
  });

  it('explicit mentions win over auto routing', async () => {
    const session = makeSession();
    const fast = stubProvider('prov-fast', 'fast-model', { reasoning: false });
    const think = stubProvider('prov-think', 'think-model', { reasoning: true });
    const orch = new ChatOrchestrator(
      makeStore(session), makeRegistry([fast.provider, think.provider]), null,
      (id) => (id === 'agent-fast' ? fast.provider : id === 'agent-think' ? think.provider : null),
      (id) => (id === 'agent-fast' ? 'fast-model' : 'think-model'),
    );
    await collectEvents(
      orch.send(
        { sessionId: 's1', text: 'Hi there @agent-think', mentions: ['agent-think'] },
        new AbortController().signal,
      ),
    );
    expect(think.requests).toHaveLength(1);
    expect(fast.requests).toHaveLength(0);
  });

  it('non-reasoning models never receive effort injection', async () => {
    const session = makeSession({ defaultAgentId: 'agent-fast' });
    const fast = stubProvider('prov-fast', 'fast-model', { reasoning: false });
    const orch = new ChatOrchestrator(
      makeStore(session), makeRegistry([fast.provider]), null,
      (id) => (id === 'agent-fast' ? fast.provider : null),
      () => 'fast-model',
    );
    await collectEvents(
      orch.send(
        { sessionId: 's1', text: '为什么天空是蓝色的', mentions: [] },
        new AbortController().signal,
      ),
    );
    expect(fast.requests[0].reasoningEffort).toBeUndefined();
  });

  it('auto routing with no available providers errors cleanly', async () => {
    const session = makeSession();
    const orch = new ChatOrchestrator(
      makeStore(session), makeRegistry([]), null,
      () => null, () => 'm',
    );
    const events = await collectEvents(
      orch.send({ sessionId: 's1', text: 'Hi', mentions: [] }, new AbortController().signal),
    );
    expect(events).toHaveLength(1);
    expect((events[0] as any).code).toBe('NO_DEFAULT_AGENT');
  });
});

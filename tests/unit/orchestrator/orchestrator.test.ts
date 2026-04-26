import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatOrchestrator } from '../../../src/main/orchestrator';
import type { OrchestratorEvent } from '../../../src/main/orchestrator/types';
import type { SessionStore } from '../../../src/main/store/session-store';
import type { ProviderRegistry } from '../../../src/main/providers';
import type { LLMProvider, ChatChunk } from '../../../src/main/providers/types';
import type { Session } from '../../../src/main/store/types';

// ── Helpers ───────────────────────────────────────────────────────

function makeMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test Session',
    createdAt: 1000,
    updatedAt: 1000,
    systemPrompt: null,
    visibilityMode: 'independent',
    groupMode: 'parallel',
    defaultAgentId: 'agent-a',
    participants: [
      { agentId: 'agent-a', personaId: 'p-a' },
      { agentId: 'agent-b', personaId: 'p-b' },
      { agentId: 'agent-c', personaId: 'p-c' },
    ],
    folderId: null,
    projectId: null,
    pinned: false,
    archived: false,
    parentMessageId: null,
    iconKind: null,
    iconValue: null,
    ...overrides,
  };
}

function makeMockStore(session: Session | null): SessionStore {
  return {
    getSession: vi.fn((id: string) => (id === session?.id ? session : null)),
    appendUserMessage: vi.fn((sessionId: string, turnId: string, text: string) => ({
      id: `msg-user-${turnId}`,
      sessionId,
      turnId,
      role: 'user' as const,
      content: text,
      status: 'done' as const,
    })),
    startAssistantMessage: vi.fn((sessionId: string, turnId: string, agentId: string, providerId: string, modelId: string) => {
      const msg = {
        id: `msg-${agentId}-${turnId}`,
        sessionId,
        turnId,
        role: 'assistant' as const,
        status: 'streaming' as const,
      };
      return msg;
    }),
    appendDelta: vi.fn(),
    finalizeAssistant: vi.fn(),
    markError: vi.fn(),
    listMessages: vi.fn(() => []),
    getMessage: vi.fn(),
    listSessions: vi.fn(() => []),
    createSession: vi.fn(),
    setDefaultAgent: vi.fn(),
    setVisibilityMode: vi.fn(),
    markPartial: vi.fn(),
    markAborted: vi.fn(),
    retry: vi.fn(),
    continueAssistant: vi.fn(),
    search: vi.fn(() => []),
    forkSession: vi.fn(),
  } as unknown as SessionStore;
}

function makeMockRegistry(providers: LLMProvider[]): ProviderRegistry {
  return {
    list: vi.fn(() => providers),
    get: vi.fn((id: string) => providers.find((p) => p.id === id)!),
    has: vi.fn((id: string) => providers.some((p) => p.id === id)),
    register: vi.fn(),
    unregister: vi.fn(),
    onProviderChanged: vi.fn(),
  } as unknown as ProviderRegistry;
}

function makeMockProvider(id: string, chunks: ChatChunk[]): LLMProvider {
  return {
    id,
    configId: `config-${id}`,
    listModels: vi.fn(async () => []),
    async *chat(_req: any, _signal: AbortSignal) {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('ChatOrchestrator', () => {
  let store: SessionStore;
  let registry: ProviderRegistry;
  let providerA: LLMProvider;
  let providerB: LLMProvider;
  let session: Session;
  let signal: AbortSignal;

  beforeEach(() => {
    session = makeMockSession();
    providerA = makeMockProvider('openai', [
      { delta: 'Hello ' },
      { delta: 'world', finishReason: 'stop' },
    ]);
    providerB = makeMockProvider('anthropic', [
      { delta: 'Hi ' },
      { delta: 'there', finishReason: 'stop' },
    ]);
    registry = makeMockRegistry([providerA, providerB]);
    store = makeMockStore(session);
    signal = new AbortController().signal;
  });

  async function collectEvents(
    gen: AsyncIterable<OrchestratorEvent>,
  ): Promise<OrchestratorEvent[]> {
    const events: OrchestratorEvent[] = [];
    for await (const ev of gen) events.push(ev);
    return events;
  }

  it('should yield turn:start and turn:complete for a single-agent turn', async () => {
    const orchestrator = new ChatOrchestrator(
      store,
      registry,
      null,
      (agentId: string) => (agentId === 'agent-a' ? providerA : null),
      () => 'gpt-4o-mini',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'Hello', mentions: ['agent-a'] },
        signal,
      ),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('turn:start');
    expect(types).toContain('turn:complete');
    expect(types).toContain('message:finish');
    expect((events.find((e) => e.type === 'turn:start') as any)?.mode).toBe('single');
  });

  it('should yield message:error when no default agent and no mentions', async () => {
    const noDefaultSession = makeMockSession({ defaultAgentId: null });
    const storeNoDefault = makeMockStore(noDefaultSession);

    const orchestrator = new ChatOrchestrator(storeNoDefault, registry, null);

    const events = await collectEvents(
      orchestrator.send({ sessionId: 'session-1', text: 'Hello', mentions: [] }, signal),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message:error');
    expect((events[0] as any).code).toBe('NO_DEFAULT_AGENT');
  });

  it('should run parallel mode with multiple agents (classifier override)', async () => {
    // With the new directed-relay default, 2+ mentions normally go to relay.
    // Use a confident classifier result to force parallel mode here.
    const classifier = {
      isEnabled: () => true,
      classify: vi.fn(async () => ({ mode: 'parallel' as const, confidence: 0.9 })),
    } as any;
    const orchestrator = new ChatOrchestrator(
      store,
      registry,
      classifier,
      (agentId: string) =>
        agentId === 'agent-a' ? providerA : agentId === 'agent-b' ? providerB : null,
      () => 'gpt-4o-mini',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'Hello everyone', mentions: ['agent-a', 'agent-b'] },
        signal,
      ),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('turn:start');
    expect(types).toContain('turn:complete');
    const startEvent = events.find((e) => e.type === 'turn:start');
    expect((startEvent as any)?.mode).toBe('parallel');
    // Both agents should produce finish events
    const finishes = events.filter((e) => e.type === 'message:finish');
    expect(finishes.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle provider failure gracefully', async () => {
    const orchestrator = new ChatOrchestrator(
      store,
      registry,
      null,
      (_agentId: string) => null, // no providers
      () => 'gpt-4o-mini',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'Hello', mentions: ['agent-a'] },
        signal,
      ),
    );

    // Should still get turn:start, error, turn:complete
    const types = events.map((e) => e.type);
    expect(types).toContain('turn:start');
    expect(types).toContain('message:error');
    expect(types).toContain('turn:complete');
  });

  it('should throw when session not found', async () => {
    const orchestrator = new ChatOrchestrator(store, registry, null);

    await expect(
      collectEvents(
        orchestrator.send(
          { sessionId: 'nonexistent', text: 'Hello', mentions: [] },
          signal,
        ),
      ),
    ).rejects.toThrow('Session not found');
  });

  it('should run directed sequential relay with one cumulative user message per agent', async () => {
    // Capture the ChatRequest each provider sees.
    const seenA: any[] = [];
    const seenB: any[] = [];
    const provA: LLMProvider = {
      id: 'openai',
      configId: 'config-openai',
      listModels: vi.fn(async () => []),
      async *chat(req: any, _signal: AbortSignal) {
        seenA.push(req);
        yield { delta: 'reply-from-a', finishReason: 'stop' } as ChatChunk;
      },
    };
    const provB: LLMProvider = {
      id: 'anthropic',
      configId: 'config-anthropic',
      listModels: vi.fn(async () => []),
      async *chat(req: any, _signal: AbortSignal) {
        seenB.push(req);
        yield { delta: 'reply-from-b', finishReason: 'stop' } as ChatChunk;
      },
    };

    const orchestrator = new ChatOrchestrator(
      store,
      registry,
      null,
      (agentId: string) => (agentId === 'agent-a' ? provA : agentId === 'agent-b' ? provB : null),
      () => 'gpt-4o-mini',
    );

    const text = '@agent-a first question @agent-b second question';
    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text, mentions: ['agent-a', 'agent-b'] },
        signal,
      ),
    );

    const startEv = events.find((e) => e.type === 'turn:start');
    expect((startEv as any)?.mode).toBe('relay');

    // Each provider received exactly one chat() invocation.
    expect(seenA.length).toBe(1);
    expect(seenB.length).toBe(1);

    // agent-a sees only its own segment, as a single user message.
    const aMsgs = seenA[0].messages.filter((m: any) => m.role === 'user');
    expect(aMsgs).toHaveLength(1);
    expect(aMsgs[0].content).toBe('@agent-a first question');
    // No assistant messages injected (cumulative is embedded in user content).
    expect(seenA[0].messages.filter((m: any) => m.role === 'assistant')).toHaveLength(0);

    // agent-b sees cumulative content with prior agent's reply inlined.
    const bMsgs = seenB[0].messages.filter((m: any) => m.role === 'user');
    expect(bMsgs).toHaveLength(1);
    expect(bMsgs[0].content).toBe(
      '@agent-a first question\n\n@agent-a: reply-from-a\n\n@agent-b second question',
    );
    expect(seenB[0].messages.filter((m: any) => m.role === 'assistant')).toHaveLength(0);
  });
});

describe('ChatOrchestrator - lead-and-comment mode', () => {
  let store: SessionStore;
  let registry: ProviderRegistry;
  let providerA: LLMProvider;
  let providerB: LLMProvider;
  let session: Session;
  let signal: AbortSignal;

  beforeEach(() => {
    session = makeMockSession({
      participants: [
        { agentId: 'agent-a', personaId: 'p-a' },
        { agentId: 'agent-b', personaId: 'p-b' },
      ],
    });
    providerA = makeMockProvider('openai', [
      { delta: 'Lead answer', finishReason: 'stop' },
    ]);
    providerB = makeMockProvider('anthropic', [
      { delta: 'Comment', finishReason: 'stop' },
    ]);
    registry = makeMockRegistry([providerA, providerB]);
    store = makeMockStore(session);
    signal = new AbortController().signal;
  });

  async function collectEvents(
    gen: AsyncIterable<OrchestratorEvent>,
  ): Promise<OrchestratorEvent[]> {
    const events: OrchestratorEvent[] = [];
    for await (const ev of gen) events.push(ev);
    return events;
  }

  it('should run lead-and-comment when lead trigger is detected', async () => {
    const orchestrator = new ChatOrchestrator(
      store,
      registry,
      null,
      (agentId: string) =>
        agentId === 'agent-a' ? providerA : agentId === 'agent-b' ? providerB : null,
      () => 'gpt-4o-mini',
    );

    const events = await collectEvents(
      orchestrator.send(
        {
          sessionId: 'session-1',
          text: '@agent-a 你来主导回答 @agent-b 点评一下',
          mentions: ['agent-a', 'agent-b'],
        },
        signal,
      ),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain('turn:start');
    expect(types).toContain('turn:complete');
    const startEvent = events.find((e) => e.type === 'turn:start');
    expect((startEvent as any)?.mode).toBe('lead-and-comment');
  });
});

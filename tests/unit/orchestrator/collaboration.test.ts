import { describe, it, expect, vi } from 'vitest';
import { ChatOrchestrator } from '../../../src/main/orchestrator';
import type { OrchestratorEvent } from '../../../src/main/orchestrator/types';
import type { SessionStore } from '../../../src/main/store/session-store';
import type { ProviderRegistry } from '../../../src/main/providers';
import type { LLMProvider, ChatChunk, ChatRequest } from '../../../src/main/providers/types';
import type { Session } from '../../../src/main/store/types';
import { parseAgentId, composeAgentId } from '../../../src/main/orchestrator/agent-id';

// ── Helpers ───────────────────────────────────────────────────────

function makeMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test Session',
    createdAt: 1000,
    updatedAt: 1000,
    systemPrompt: null,
    visibilityMode: 'full',
    groupMode: 'auto',
    defaultAgentId: 'agent-a',
    participants: [
      { agentId: 'agent-a', personaId: 'p-a' },
      { agentId: 'agent-b', personaId: 'p-b' },
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

function makeMockStore(session: Session | null, priorMessages: any[] = []): SessionStore {
  return {
    getSession: vi.fn((id: string) => (id === session?.id ? session : null)),
    appendUserMessage: vi.fn((_sessionId: string, turnId: string, text: string) => ({
      id: `msg-user-${turnId}`,
      sessionId: _sessionId,
      turnId,
      role: 'user' as const,
      content: text,
      status: 'done' as const,
    })),
    startAssistantMessage: vi.fn((_s: string, turnId: string, agentId: string) => ({
      id: `msg-${agentId}-${turnId}`,
      role: 'assistant' as const,
      status: 'streaming' as const,
    })),
    appendDelta: vi.fn(),
    finalizeAssistant: vi.fn(),
    markError: vi.fn(),
    listMessages: vi.fn(() => priorMessages),
    getMessage: vi.fn(),
    listSessions: vi.fn(() => []),
  } as unknown as SessionStore;
}

function makeMockRegistry(providers: LLMProvider[]): ProviderRegistry {
  return {
    list: vi.fn(() => providers),
    get: vi.fn((id: string) => providers.find((p) => p.id === id)!),
    has: vi.fn((id: string) => providers.some((p) => p.id === id)),
  } as unknown as ProviderRegistry;
}

/** Provider that records every request it receives. */
function recordingProvider(id: string, reply: string, seen: ChatRequest[]): LLMProvider {
  return {
    id,
    configId: `config-${id}`,
    listModels: vi.fn(async () => []),
    async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
      seen.push(req);
      yield { delta: reply, finishReason: 'stop' } as ChatChunk;
    },
  };
}

async function collectEvents(gen: AsyncIterable<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

// ── Agent instance ids ────────────────────────────────────────────

describe('agent instance ids', () => {
  it('parses plain provider ids', () => {
    expect(parseAgentId('openai-prod')).toEqual({ providerId: 'openai-prod', personaId: null });
  });
  it('parses composite provider::persona ids', () => {
    expect(parseAgentId('openai-prod::persona-99')).toEqual({
      providerId: 'openai-prod',
      personaId: 'persona-99',
    });
  });
  it('composes and round-trips', () => {
    const id = composeAgentId('prov', 'p1');
    expect(id).toBe('prov::p1');
    expect(parseAgentId(id)).toEqual({ providerId: 'prov', personaId: 'p1' });
  });
  it('compose without persona returns plain id', () => {
    expect(composeAgentId('prov')).toBe('prov');
    expect(composeAgentId('prov', null)).toBe('prov');
  });
});

// ── Roundtable mode ───────────────────────────────────────────────

describe('ChatOrchestrator roundtable mode', () => {
  it('runs every agent once per round with growing transcript', async () => {
    const session = makeMockSession({ groupMode: 'roundtable' });
    const seenA: ChatRequest[] = [];
    const seenB: ChatRequest[] = [];
    const provA = recordingProvider('prov-a', 'view A', seenA);
    const provB = recordingProvider('prov-b', 'view B', seenB);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([provA, provB]),
      null,
      (agentId) => (agentId === 'agent-a' ? provA : agentId === 'agent-b' ? provB : null),
      () => 'model-x',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'discuss together', mentions: ['agent-a', 'agent-b'] },
        new AbortController().signal,
      ),
    );

    const startEv = events.find((e) => e.type === 'turn:start');
    expect((startEv as any)?.mode).toBe('roundtable');

    // 2 rounds × 2 agents → 2 requests per provider.
    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(2);

    // Round 1: no transcript yet.
    expect(seenA[0].messages.join()).not.toContain('Discussion so far');

    // Round 2: agent-a (first in order) sees agent-b's round-1 reply.
    const round2User = seenA[1].messages.filter((m) => m.role === 'user').at(-1);
    expect(round2User?.content).toContain('agent-b: view B');
    // agent-b (second in order) sees agent-a's round-2 reply too.
    const bRound2User = seenB[1].messages.filter((m) => m.role === 'user').at(-1);
    expect(bRound2User?.content).toContain('agent-a: view A');
    expect(bRound2User?.content).toContain('round 2/2');
  });

  it('roundtable trigger phrase routes to roundtable', async () => {
    const session = makeMockSession();
    const provA = recordingProvider('prov-a', 'x', []);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([provA]),
      null,
      (id) => (id === 'agent-a' ? provA : null),
      () => 'model-x',
    );
    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: '圆桌讨论：remote work', mentions: ['agent-a', 'agent-b'] },
        new AbortController().signal,
      ),
    );
    expect(((events.find((e) => e.type === 'turn:start') as any)?.mode)).toBe('roundtable');
  });
});

// ── Parallel concurrency ──────────────────────────────────────────

describe('ChatOrchestrator parallel mode', () => {
  it('streams both agents concurrently', async () => {
    const session = makeMockSession({ groupMode: 'parallel' });
    let active = 0;
    let maxActive = 0;

    function slowProvider(id: string): LLMProvider {
      return {
        id,
        configId: `config-${id}`,
        listModels: vi.fn(async () => []),
        async *chat(_req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
          active++;
          maxActive = Math.max(maxActive, active);
          // Keep the stream open long enough for the other agent to start.
          await new Promise((r) => setTimeout(r, 30));
          if (signal.aborted) return;
          active--;
          yield { delta: `reply-${id}`, finishReason: 'stop' } as ChatChunk;
        },
      };
    }

    const provA = slowProvider('prov-a');
    const provB = slowProvider('prov-b');
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([provA, provB]),
      null,
      (id) => (id === 'agent-a' ? provA : id === 'agent-b' ? provB : null),
      () => 'model-x',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'hello', mentions: ['agent-a', 'agent-b'] },
        new AbortController().signal,
      ),
    );

    expect(maxActive).toBe(2);
    const finishes = events.filter((e) => e.type === 'message:finish');
    expect(finishes).toHaveLength(2);
  });
});

// ── Multi-turn history ────────────────────────────────────────────

describe('ChatOrchestrator history', () => {
  it('passes prior finalized conversation into agent context', async () => {
    const session = makeMockSession();
    const prior = [
      {
        id: 'm1', sessionId: 'session-1', turnId: 't0', role: 'user',
        content: 'earlier question', status: 'done', createdAt: 1,
      },
      {
        id: 'm2', sessionId: 'session-1', turnId: 't0', role: 'assistant',
        content: 'earlier answer', status: 'done', createdAt: 2,
        metaJson: JSON.stringify({ agentId: 'agent-a' }),
      },
      {
        id: 'm3', sessionId: 'session-1', turnId: 't0', role: 'assistant',
        content: 'streaming leftover', status: 'streaming', createdAt: 3,
        metaJson: JSON.stringify({ agentId: 'agent-b' }),
      },
    ];
    const seen: ChatRequest[] = [];
    const provA = recordingProvider('prov-a', 'ok', seen);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session, prior),
      makeMockRegistry([provA]),
      null,
      (id) => (id === 'agent-a' ? provA : null),
      () => 'model-x',
    );

    await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'follow-up', mentions: ['agent-a'] },
        new AbortController().signal,
      ),
    );

    // full visibility: user history + finalized assistant history; the
    // still-streaming message is excluded.
    const msgs = seen[0].messages;
    expect(msgs.some((m) => m.role === 'user' && (m as any).content === 'earlier question')).toBe(true);
    expect(msgs.some((m) => m.role === 'assistant' && (m as any).content === 'earlier answer')).toBe(true);
    expect(msgs.some((m) => (m as any).content === 'streaming leftover')).toBe(false);
  });

  it('independent visibility filters other agents from history', async () => {
    const session = makeMockSession({ visibilityMode: 'independent' });
    const prior = [
      {
        id: 'm1', sessionId: 'session-1', turnId: 't0', role: 'assistant',
        content: 'other agent said this', status: 'done', createdAt: 1,
        metaJson: JSON.stringify({ agentId: 'agent-b' }),
      },
      {
        id: 'm2', sessionId: 'session-1', turnId: 't0', role: 'assistant',
        content: 'my own prior reply', status: 'done', createdAt: 2,
        metaJson: JSON.stringify({ agentId: 'agent-a' }),
      },
    ];
    const seen: ChatRequest[] = [];
    const provA = recordingProvider('prov-a', 'ok', seen);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session, prior),
      makeMockRegistry([provA]),
      null,
      (id) => (id === 'agent-a' ? provA : null),
      () => 'model-x',
    );

    await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'again', mentions: ['agent-a'] },
        new AbortController().signal,
      ),
    );

    const contents = seen[0].messages.map((m) => (m as any).content);
    expect(contents).toContain('my own prior reply');
    expect(contents).not.toContain('other agent said this');
  });
});

// ── Agent instance resolution through the orchestrator ────────────

describe('ChatOrchestrator agent instances', () => {
  it('resolves composite ids to the same provider with distinct persona prompts', async () => {
    const session = makeMockSession({
      participants: [
        { agentId: 'prov::p-architect', personaId: 'p-architect' },
        { agentId: 'prov::p-critic', personaId: 'p-critic' },
      ],
    });
    const seen: ChatRequest[] = [];
    const prov = recordingProvider('prov', 'ok', seen);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([prov]),
      null,
      // Mirror chat-router: provider comes from the composite id's provider part.
      (agentId) => {
        const { providerId } = parseAgentId(agentId);
        return providerId === 'prov' ? prov : null;
      },
      () => 'model-x',
      // Mirror chat-router: persona prompt from the embedded persona.
      (_sessionId, agentId) => {
        const { personaId } = parseAgentId(agentId);
        if (personaId === 'p-architect') return 'You are a software architect.';
        if (personaId === 'p-critic') return 'You are a ruthless critic.';
        return null;
      },
    );

    await collectEvents(
      orchestrator.send(
        {
          sessionId: 'session-1',
          text: '@prov::p-architect design it @prov::p-critic review it',
          mentions: ['prov::p-architect', 'prov::p-critic'],
        },
        new AbortController().signal,
      ),
    );

    // Same underlying provider object served both expert instances.
    expect(seen).toHaveLength(2);
    const sysA = seen[0].messages.find((m) => m.role === 'system');
    const sysB = seen[1].messages.find((m) => m.role === 'system');
    expect((sysA as any)?.content).toContain('architect');
    expect((sysB as any)?.content).toContain('critic');
  });

  it('uses agent labels for cross-agent transcript lines', async () => {
    const session = makeMockSession();
    const seenA: ChatRequest[] = [];
    const seenB: ChatRequest[] = [];
    const provA = recordingProvider('prov-a', 'draft text', seenA);
    const provB = recordingProvider('prov-b', 'refined', seenB);
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([provA, provB]),
      null,
      (id) => (id === 'agent-a' ? provA : id === 'agent-b' ? provB : null),
      () => 'model-x',
      undefined,
      undefined,
      undefined,
      undefined,
      // getAgentLabel: persona-style labels for the transcript
      (id) => (id === 'agent-a' ? 'Architect' : id === 'agent-b' ? 'Critic' : id),
    );

    await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: '@agent-a draft @agent-b refine', mentions: ['agent-a', 'agent-b'] },
        new AbortController().signal,
      ),
    );

    const bUser = seenB[0].messages.filter((m) => m.role === 'user').at(-1);
    expect(bUser?.content).toContain('Architect: draft text');
  });

  it('emits per-agent error when the mentioned agent has no provider', async () => {
    const session = makeMockSession();
    const orchestrator = new ChatOrchestrator(
      makeMockStore(session),
      makeMockRegistry([]),
      null,
      () => null,
      () => 'model-x',
    );

    const events = await collectEvents(
      orchestrator.send(
        { sessionId: 'session-1', text: 'hello @ghost', mentions: ['ghost'] },
        new AbortController().signal,
      ),
    );

    const errors = events.filter((e) => e.type === 'message:error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).code).toBe('PROVIDER_NOT_CONFIGURED');
    expect((errors[0] as any).agentId).toBe('ghost');
  });
});

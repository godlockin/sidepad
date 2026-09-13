import { describe, it, expect, vi } from 'vitest';
import { ChatOrchestrator, capToolResult, type SessionToolResolver } from '../../../src/main/orchestrator';
import { flattenMcpResult } from '../../../src/main/mcp/flatten';
import type { OrchestratorEvent } from '../../../src/main/orchestrator/types';
import type { SessionStore } from '../../../src/main/store/session-store';
import type { ProviderRegistry } from '../../../src/main/providers';
import type { LLMProvider, ChatRequest, ChatChunk } from '../../../src/main/providers/types';
import type { Session } from '../../../src/main/store/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1', title: 'T', createdAt: 1, updatedAt: 1, systemPrompt: null,
    visibilityMode: 'full', groupMode: 'auto', defaultAgentId: 'agent-a',
    participants: [{ agentId: 'agent-a', personaId: 'p-a' }, { agentId: 'agent-b', personaId: 'p-b' }],
    folderId: null, projectId: null, pinned: false, archived: false,
    parentMessageId: null, iconKind: null, iconValue: null,
    ...overrides,
  };
}

function makeStore(session: Session, priorMessages: any[] = []): SessionStore {
  let counter = 0;
  return {
    getSession: vi.fn((id: string) => (id === session.id ? session : null)),
    appendUserMessage: vi.fn(() => ({ id: 'u1' })),
    startAssistantMessage: vi.fn((_s: string, _t: string, agentId: string) => ({
      id: `msg-${agentId}-${++counter}`, role: 'assistant', status: 'streaming',
    })),
    appendDelta: vi.fn(),
    finalizeAssistant: vi.fn(),
    markError: vi.fn(),
    listMessages: vi.fn(() => priorMessages),
  } as unknown as SessionStore;
}

function makeRegistry(providers: LLMProvider[]): ProviderRegistry {
  return {
    list: vi.fn(() => providers),
    get: vi.fn((id: string) => providers.find((p) => p.id === id)!),
    has: vi.fn((id: string) => providers.some((p) => p.id === id)),
  } as unknown as ProviderRegistry;
}

async function collectEvents(gen: AsyncIterable<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const events: OrchestratorEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

// ── capToolResult ─────────────────────────────────────────────────

describe('capToolResult', () => {
  it('passes short results through unchanged', () => {
    expect(capToolResult('short')).toBe('short');
  });
  it('caps oversized results with a marker', () => {
    const huge = 'x'.repeat(10_000);
    const capped = capToolResult(huge);
    expect(capped.length).toBeLessThan(10_000);
    expect(capped).toContain('[... truncated');
  });
  it('stringifies non-string results', () => {
    expect(capToolResult({ a: 1 })).toBe('{"a":1}');
  });
});

// ── flattenMcpResult ──────────────────────────────────────────────

describe('flattenMcpResult', () => {
  it('extracts and joins text blocks', () => {
    const r = { content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] };
    expect(flattenMcpResult(r)).toBe('line one\nline two');
  });
  it('summarizes non-text blocks instead of dumping their envelope', () => {
    const r = {
      content: [
        { type: 'text', text: 'here' },
        { type: 'image', data: 'AAAA' },
        { type: 'resource', resource: { uri: 'file:///x' } },
      ],
    };
    expect(flattenMcpResult(r)).toBe('here\n[2 non-text content blocks omitted]');
  });
  it('returns empty string for empty/missing content', () => {
    expect(flattenMcpResult({ content: [] })).toBe('');
    expect(flattenMcpResult({})).toBe('{}');
    expect(flattenMcpResult(null)).toBe('');
  });
  it('passes plain strings through', () => {
    expect(flattenMcpResult('raw')).toBe('raw');
  });
});

// ── Tool results through the loop ─────────────────────────────────

describe('tool result budget in the loop', () => {
  it('caps an oversized tool result before it reaches the model', async () => {
    let round = 0;
    const requestsSeen: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: 'stub', configId: 'cfg', listModels: async () => [],
      async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        requestsSeen.push(req);
        round++;
        if (round === 1) {
          yield { finishReason: 'tool_calls', toolCalls: [{ id: 'c1', name: 'dump', arguments: {} }] };
        } else {
          yield { delta: 'done', finishReason: 'stop' };
        }
      },
    };
    const resolver: SessionToolResolver = {
      async listToolsForSession() {
        return [{ tool: { name: 'dump', inputSchema: {} }, serverId: 'srv' }];
      },
      async callTool() {
        return { result: 'y'.repeat(50_000), isError: false };
      },
      recordUsage: vi.fn(),
    };
    const orchestrator = new ChatOrchestrator(
      makeStore(makeSession()), makeRegistry([provider]), null,
      () => provider, () => 'm', undefined, undefined, resolver,
    );
    const events = await collectEvents(
      orchestrator.send({ sessionId: 's1', text: 'go', mentions: ['agent-a'] }, new AbortController().signal),
    );
    expect(events.some((e) => e.type === 'message:finish')).toBe(true);
    const toolMsg = requestsSeen[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content.length).toBeLessThan(50_000);
    expect((toolMsg as any).content).toContain('[... truncated');
  });
});

// ── Concurrent tool execution ─────────────────────────────────────

describe('concurrent tool calls in one round', () => {
  it('executes multiple tool calls of the same round concurrently', async () => {
    let round = 0;
    const requestsSeen: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: 'stub', configId: 'cfg', listModels: async () => [],
      async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        requestsSeen.push(req);
        round++;
        if (round === 1) {
          yield {
            finishReason: 'tool_calls',
            toolCalls: [
              { id: 'c1', name: 'slow', arguments: {} },
              { id: 'c2', name: 'slow', arguments: {} },
            ],
          };
        } else {
          yield { delta: 'ok', finishReason: 'stop' };
        }
      },
    };
    let active = 0;
    let maxActive = 0;
    const resolver: SessionToolResolver = {
      async listToolsForSession() {
        return [{ tool: { name: 'slow', inputSchema: {} }, serverId: 'srv' }];
      },
      async callTool() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active--;
        return { result: 'ok', isError: false };
      },
      recordUsage: vi.fn(),
    };
    const orchestrator = new ChatOrchestrator(
      makeStore(makeSession()), makeRegistry([provider]), null,
      () => provider, () => 'm', undefined, undefined, resolver,
    );
    const events = await collectEvents(
      orchestrator.send({ sessionId: 's1', text: 'go', mentions: ['agent-a'] }, new AbortController().signal),
    );

    expect(maxActive).toBe(2);
    const starts = events.filter((e) => e.type === 'tool_call:start');
    const results = events.filter((e) => e.type === 'tool_call:result');
    expect(starts).toHaveLength(2);
    expect(results).toHaveLength(2);
    // Both results reference the two distinct tool calls.
    expect(new Set(results.map((r: any) => r.toolCallId))).toEqual(new Set(['c1', 'c2']));
    // Second-round request carries both tool results.
    const toolMsgs = requestsSeen[1].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
  });
});

// ── Token budget in sequential modes ──────────────────────────────

describe('token budget applies to sequential modes', () => {
  it('relay context is truncated to the model budget', async () => {
    // 20 prior messages x ~500 tokens each, but the "model" window is tiny.
    const prior = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, sessionId: 's1', turnId: 't0', role: 'assistant',
      content: 'word '.repeat(2500), status: 'done', createdAt: i,
      metaJson: JSON.stringify({ agentId: 'agent-a' }),
    }));
    const seen: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: 'stub', configId: 'cfg', listModels: async () => [],
      async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        seen.push(req);
        yield { delta: 'ok', finishReason: 'stop' };
      },
    };
    const orchestrator = new ChatOrchestrator(
      makeStore(makeSession({ groupMode: 'auto' }), prior), makeRegistry([provider]), null,
      (id) => (id === 'agent-a' ? provider : null),
      () => 'm',
      undefined, undefined, undefined,
      () => 4_000, // tiny context window → aggressive budget
    );
    await collectEvents(
      orchestrator.send(
        { sessionId: 's1', text: '@agent-a go @agent-b continue', mentions: ['agent-a', 'agent-b'] },
        new AbortController().signal,
      ),
    );

    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Without truncation the context would carry all 20 x 2500-word messages.
    const totalChars = seen[0].messages.reduce((sum, m) => sum + ((m as any).content?.length ?? 0), 0);
    expect(totalChars).toBeLessThan('word '.repeat(2500).length * 20);
    // The current user turn survives truncation.
    const lastUser = seen[0].messages.filter((m) => m.role === 'user').at(-1);
    expect((lastUser as any)?.content).toContain('@agent-a go');
  });
});

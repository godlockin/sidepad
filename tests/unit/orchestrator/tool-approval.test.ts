import { describe, it, expect } from 'vitest';
import {
  ToolApprovalGate,
  parseToolApprovalMode,
} from '@main/orchestrator/tool-approval';
import { ChatOrchestrator, type SessionToolResolver } from '@main/orchestrator';
import type { OrchestratorEvent } from '@main/orchestrator/types';
import type { SessionStore } from '@main/store/session-store';
import type { ProviderRegistry } from '@main/providers';
import type { LLMProvider, ChatRequest, ChatChunk } from '@main/providers/types';
import type { Session } from '@main/store/types';
import { vi } from 'vitest';

describe('parseToolApprovalMode', () => {
  it('defaults to off', () => {
    expect(parseToolApprovalMode(undefined)).toBe('off');
    expect(parseToolApprovalMode('auto')).toBe('off');
  });
  it('accepts ask', () => {
    expect(parseToolApprovalMode('ask')).toBe('ask');
  });
});

describe('ToolApprovalGate', () => {
  it('resolves approve/deny', async () => {
    const gate = new ToolApprovalGate();
    const p = gate.request('c1', new AbortController().signal);
    expect(gate.has('c1')).toBe(true);
    expect(gate.decide('c1', 'approve')).toBe(true);
    await expect(p).resolves.toBe('approve');
    expect(gate.has('c1')).toBe(false);
  });
  it('aborts pending waiters', async () => {
    const gate = new ToolApprovalGate();
    const ac = new AbortController();
    const p = gate.request('c2', ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function makeSession(): Session {
  return {
    id: 's1', title: 'T', createdAt: 1, updatedAt: 1, systemPrompt: null,
    visibilityMode: 'full', groupMode: 'auto', defaultAgentId: 'agent-a',
    participants: [{ agentId: 'agent-a', personaId: 'p-a' }],
    folderId: null, projectId: null, pinned: false, archived: false,
    parentMessageId: null, iconKind: null, iconValue: null,
  };
}

function makeStore(session: Session): SessionStore {
  let counter = 0;
  return {
    getSession: vi.fn(() => session),
    appendUserMessage: vi.fn(() => ({ id: 'u1' })),
    startAssistantMessage: vi.fn(() => ({
      id: `msg-${++counter}`, role: 'assistant', status: 'streaming',
    })),
    appendDelta: vi.fn(),
    finalizeAssistant: vi.fn(),
    markError: vi.fn(),
    markAborted: vi.fn(),
    listMessages: vi.fn(() => []),
  } as unknown as SessionStore;
}

async function collect(gen: AsyncIterable<OrchestratorEvent>): Promise<OrchestratorEvent[]> {
  const out: OrchestratorEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('orchestrator ask-mode approval', () => {
  it('pauses for approval and skips denied tools', async () => {
    let round = 0;
    const callTool = vi.fn(async () => ({ result: 'ran', isError: false }));
    const provider: LLMProvider = {
      id: 'stub', configId: 'cfg', listModels: async () => [],
      async *chat(_req: ChatRequest, _s: AbortSignal): AsyncIterable<ChatChunk> {
        round++;
        if (round === 1) {
          yield {
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'c1', name: 'echo', arguments: { x: 1 } }],
          };
        } else {
          yield { delta: 'ok', finishReason: 'stop' };
        }
      },
    };
    const resolver: SessionToolResolver = {
      async listToolsForSession() {
        return [{ tool: { name: 'echo', inputSchema: {} }, serverId: 'srv' }];
      },
      callTool,
      recordUsage: vi.fn(),
    };
    const gate = new ToolApprovalGate();
    const orch = new ChatOrchestrator(
      makeStore(makeSession()),
      { list: () => [provider], get: () => provider, has: () => true } as unknown as ProviderRegistry,
      null,
      () => provider,
      () => 'm',
      undefined,
      undefined,
      resolver,
      undefined,
      undefined,
      gate,
      () => 'ask',
    );

    const eventsP = collect(
      orch.send({ sessionId: 's1', text: 'go', mentions: ['agent-a'] }, new AbortController().signal),
    );
    // Wait until awaiting_approval is emitted
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.has('c1')).toBe(true);
    gate.decide('c1', 'deny');
    const events = await eventsP;
    expect(events.some((e) => e.type === 'tool_call:awaiting_approval')).toBe(true);
    expect(callTool).not.toHaveBeenCalled();
    const result = events.find((e) => e.type === 'tool_call:result') as Extract<
      OrchestratorEvent,
      { type: 'tool_call:result' }
    >;
    expect(result?.isError).toBe(true);
  });
});

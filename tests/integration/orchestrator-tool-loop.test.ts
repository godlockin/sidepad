import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openSidepadDb } from '@main/store/db';
import { ChatOrchestrator, type SessionToolResolver } from '@main/orchestrator';
import type { SessionStore } from '@main/store/session-store';
import type { ProviderRegistry } from '@main/providers';
import type { LLMProvider, ChatRequest, ChatChunk, ToolDefinition } from '@main/providers/types';
import type { Session } from '@main/store/types';
import type { OrchestratorEvent } from '@main/orchestrator/types';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-tool-loop-'));
  dbPath = path.join(tmpDir, 'sidepad.db');
});

afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function makeSession(): Session {
  return {
    id: 's-tool',
    title: 'T',
    createdAt: 1,
    updatedAt: 1,
    systemPrompt: null,
    visibilityMode: 'independent',
    groupMode: 'parallel',
    defaultAgentId: 'agent-a',
    participants: [{ agentId: 'agent-a', personaId: 'default' }],
    folderId: null,
    projectId: null,
    pinned: false,
    archived: false,
    parentMessageId: null,
  } as unknown as Session;
}

function makeStore(captured: { msgIds: string[] }): SessionStore {
  let counter = 0;
  return {
    getSession: () => makeSession(),
    appendUserMessage: () => ({}),
    startAssistantMessage: (_s: string, _t: string, agentId: string) => {
      const id = `msg-${++counter}`;
      captured.msgIds.push(id);
      return { id };
    },
    appendDelta: () => undefined,
    finalizeAssistant: () => undefined,
    markError: () => undefined,
  } as unknown as SessionStore;
}

function makeRegistry(provider: LLMProvider): ProviderRegistry {
  return {
    list: () => [provider],
    get: () => provider,
    has: () => true,
    register: () => undefined,
    unregister: () => undefined,
    onProviderChanged: () => undefined,
  } as unknown as ProviderRegistry;
}

describe('Orchestrator tool-call loop', () => {
  it('runs provider → tool → provider, persists usage, emits tool_call events', async () => {
    const db = openSidepadDb(dbPath);

    // Stub provider: round 1 yields a tool call; round 2 yields final text.
    let round = 0;
    const requestsSeen: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: 'stub',
      configId: 'cfg',
      listModels: async () => [],
      async *chat(req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        requestsSeen.push(req);
        round++;
        if (round === 1) {
          yield {
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: 'hi' } }],
          };
        } else {
          yield { delta: 'final answer' };
          yield { finishReason: 'stop' };
        }
      },
    };

    const echoTool: ToolDefinition = {
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    };

    const calls: Array<{ serverId: string; name: string; args: any }> = [];
    const resolver: SessionToolResolver = {
      async listToolsForSession() {
        return [{ tool: echoTool, serverId: 'srv-1' }];
      },
      async callTool(serverId, name, args) {
        calls.push({ serverId, name, args });
        return { result: { content: [{ type: 'text', text: `echo:${args.text}` }] }, isError: false };
      },
      recordUsage(opts) {
        const { randomUUID } = require('node:crypto');
        db.prepare(
          'INSERT INTO mcp_tool_usage (id, message_id, server_id, tool_name, args_json, result_json, error, created_at) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          opts.messageId,
          opts.serverId,
          opts.toolName,
          JSON.stringify(opts.args ?? {}),
          opts.result === undefined ? null : JSON.stringify(opts.result),
          opts.error ?? null,
          Date.now(),
        );
      },
    };

    const captured = { msgIds: [] as string[] };
    const store = makeStore(captured);
    const registry = makeRegistry(provider);

    const orch = new ChatOrchestrator(
      store,
      registry,
      null,
      () => provider,
      () => 'gpt-4o-mini',
      () => null,
      () => '',
      resolver,
    );

    const events: OrchestratorEvent[] = [];
    for await (const ev of orch.send(
      { sessionId: 's-tool', text: 'use the tool', mentions: ['agent-a'] },
      new AbortController().signal,
    )) {
      events.push(ev);
    }

    // We should have seen two provider rounds (initial + after tool result).
    expect(requestsSeen.length).toBe(2);

    // Round 1 had tools[]; round 2 also had tools[] and the assistant + tool messages.
    expect(requestsSeen[0].tools).toEqual([echoTool]);
    const round2Msgs = requestsSeen[1].messages;
    const assistantWithTool = round2Msgs.find(
      (m) => m.role === 'assistant' && (m as any).toolCalls?.length,
    );
    expect(assistantWithTool).toBeTruthy();
    const toolMsg = round2Msgs.find((m) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect((toolMsg as any).toolCallId).toBe('call_1');

    // Tool was actually called.
    expect(calls).toEqual([{ serverId: 'srv-1', name: 'echo', args: { text: 'hi' } }]);

    // Event sequence includes tool_call:start and tool_call:result.
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call:start');
    expect(types).toContain('tool_call:result');
    expect(types).toContain('message:finish');

    const startEv = events.find((e) => e.type === 'tool_call:start') as any;
    expect(startEv.toolName).toBe('echo');
    expect(startEv.serverId).toBe('srv-1');

    const resultEv = events.find((e) => e.type === 'tool_call:result') as any;
    expect(resultEv.isError).toBe(false);
    expect(typeof resultEv.durationMs).toBe('number');

    // Persisted usage row.
    const rows = db.prepare('SELECT * FROM mcp_tool_usage').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tool_name).toBe('echo');
    expect(rows[0].server_id).toBe('srv-1');
    expect(JSON.parse(rows[0].args_json)).toEqual({ text: 'hi' });
  });

  it('emits tool_loop_exceeded when provider keeps calling tools beyond cap', async () => {
    const db = openSidepadDb(dbPath);
    const provider: LLMProvider = {
      id: 'loopy',
      configId: 'cfg',
      listModels: async () => [],
      async *chat(_req: ChatRequest, _signal: AbortSignal): AsyncIterable<ChatChunk> {
        yield {
          finishReason: 'tool_calls',
          toolCalls: [{ id: `call_${Math.random()}`, name: 'echo', arguments: {} }],
        };
      },
    };
    const echoTool: ToolDefinition = {
      name: 'echo',
      inputSchema: { type: 'object', properties: {} },
    };
    const resolver: SessionToolResolver = {
      async listToolsForSession() {
        return [{ tool: echoTool, serverId: 'srv-1' }];
      },
      async callTool() {
        return { result: 'ok', isError: false };
      },
      recordUsage() {
        // no-op
      },
    };
    const captured = { msgIds: [] as string[] };
    const orch = new ChatOrchestrator(
      makeStore(captured),
      makeRegistry(provider),
      null,
      () => provider,
      () => 'gpt-4o-mini',
      () => null,
      () => '',
      resolver,
    );
    const events: OrchestratorEvent[] = [];
    for await (const ev of orch.send(
      { sessionId: 's-tool', text: 'go', mentions: ['agent-a'] },
      new AbortController().signal,
    )) {
      events.push(ev);
    }
    const errEv = events.find(
      (e) => e.type === 'message:error' && (e as any).code === 'tool_loop_exceeded',
    );
    expect(errEv).toBeTruthy();
    db.close();
  });
});

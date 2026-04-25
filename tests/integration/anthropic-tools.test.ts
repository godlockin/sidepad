import { describe, it, expect, vi } from 'vitest';

const streamMock = vi.fn();
const sentinel = { calls: [] as any[] };

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any, _config: any) {
    this.messages = { stream: streamMock, create: vi.fn() };
    this.models = { list: vi.fn() };
  };
  return { default: MockAnthropic };
});

function fakeStream(events: any[], finalMessage: any) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    finalMessage: async () => finalMessage,
  };
}

describe('AnthropicProvider tool-use', () => {
  it('reconstructs tool_use input from input_json_delta fragments', async () => {
    streamMock.mockImplementation((args: any) => {
      sentinel.calls.push(args);
      return fakeStream(
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'tu_1', name: 'echo', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"te' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: 'xt":"hi"}' },
          },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        ],
        { stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 2 } },
      );
    });

    const { AnthropicProvider } = await import('../../src/main/providers/anthropic');
    const p = new AnthropicProvider('anthropic', 'cfg', 'sk-ant-test');
    const chunks: any[] = [];
    for await (const c of p.chat(
      {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'use echo' }],
        tools: [
          {
            name: 'echo',
            description: 'echoes',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const callArg = sentinel.calls[0];
    expect(callArg.tools).toEqual([
      {
        name: 'echo',
        description: 'echoes',
        input_schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ]);
    const finish = chunks.find((c) => c.finishReason);
    expect(finish.finishReason).toBe('tool_calls');
    expect(finish.toolCalls).toEqual([
      { id: 'tu_1', name: 'echo', arguments: { text: 'hi' } },
    ]);
  });

  it("translates role:'tool' messages into a user turn with tool_result blocks", async () => {
    streamMock.mockImplementation((args: any) => {
      sentinel.calls.push(args);
      return fakeStream(
        [
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        ],
        { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
      );
    });
    const { AnthropicProvider } = await import('../../src/main/providers/anthropic');
    const p = new AnthropicProvider('anthropic', 'cfg2', 'sk-ant-test');
    const _drain: any[] = [];
    for await (const c of p.chat(
      {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'do it' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tu_1', name: 'echo', arguments: { text: 'hi' } }],
          },
          { role: 'tool', toolCallId: 'tu_1', content: 'echo:hi' },
        ],
      },
      new AbortController().signal,
    )) {
      _drain.push(c);
    }
    const sent = sentinel.calls[sentinel.calls.length - 1].messages;
    const assistantMsg = sent.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.content).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'echo', input: { text: 'hi' } },
    ]);
    const toolUserMsg = sent[sent.length - 1];
    expect(toolUserMsg.role).toBe('user');
    expect(toolUserMsg.content).toEqual([
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'echo:hi' },
    ]);
  });
});

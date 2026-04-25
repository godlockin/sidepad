import { describe, it, expect, vi } from 'vitest';

const mockInstances: any[] = [];
vi.mock('openai', () => ({
  default: class {
    constructor(..._args: any[]) {
      const inst = mockInstances.pop() || {
        chat: { completions: { create: vi.fn() } },
        models: { list: vi.fn() },
      };
      Object.assign(this, inst);
    }
  },
}));

describe('OpenAIProvider tool-calling', () => {
  it('accumulates streamed tool_call argument fragments and emits final toolCalls', async () => {
    const createMock = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'echo', arguments: '{"te' } },
                ],
              },
            },
          ],
        };
        yield {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"hi"}' } }] } },
          ],
        };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    });
    mockInstances.push({
      chat: { completions: { create: createMock } },
      models: { list: vi.fn() },
    });

    const { OpenAIProvider } = await import('../../src/main/providers/openai');
    const p = new OpenAIProvider('openai', 'cfg', 'sk-test');
    const chunks: any[] = [];
    for await (const c of p.chat(
      {
        model: 'gpt-4o-mini',
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

    // verify tools were forwarded
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'echoes',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      },
    ]);

    const finish = chunks.find((c) => c.finishReason);
    expect(finish.finishReason).toBe('tool_calls');
    expect(finish.toolCalls).toEqual([
      { id: 'call_1', name: 'echo', arguments: { text: 'hi' } },
    ]);
  });

  it("translates role:'tool' messages into OpenAI tool messages", async () => {
    const createMock = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'ok' } }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    });
    mockInstances.push({
      chat: { completions: { create: createMock } },
      models: { list: vi.fn() },
    });

    const { OpenAIProvider } = await import('../../src/main/providers/openai');
    const p = new OpenAIProvider('openai', 'cfg', 'sk-test');
    const _drain: any[] = [];
    for await (const c of p.chat(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: 'do it' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'echo', arguments: { text: 'hi' } }],
          },
          { role: 'tool', toolCallId: 'call_1', content: 'echo:hi' },
        ],
      },
      new AbortController().signal,
    )) {
      _drain.push(c);
    }
    const sent = createMock.mock.calls[0][0].messages;
    const assistantMsg = sent.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"hi"}' } },
    ]);
    const toolMsg = sent.find((m: any) => m.role === 'tool');
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'echo:hi' });
  });
});

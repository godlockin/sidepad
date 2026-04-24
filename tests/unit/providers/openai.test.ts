import { describe, it, expect, vi } from 'vitest';

// Shared state that the mock factory reads
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

describe('OpenAIProvider', () => {
  it('creates with id and configId', async () => {
    mockInstances.push({
      chat: { completions: { create: vi.fn() } },
      models: { list: vi.fn() },
    });

    const { OpenAIProvider } = await import('../../../src/main/providers/openai');
    const p = new OpenAIProvider('openai', 'cfg-oai', 'sk-test');
    expect(p.id).toBe('openai');
    expect(p.configId).toBe('cfg-oai');
  });

  it('chat yields deltas from stream', async () => {
    mockInstances.push({
      chat: { completions: {
        create: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: { content: 'Hello' } }] };
            yield { choices: [{ delta: { content: ' World' } }] };
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          },
        }),
      }},
      models: { list: vi.fn() },
    });

    const { OpenAIProvider } = await import('../../../src/main/providers/openai');
    const p = new OpenAIProvider('openai', 'cfg-oai', 'sk-test');
    const ac = new AbortController();
    const chunks: any[] = [];
    for await (const c of p.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }, ac.signal))
      chunks.push(c);

    expect(chunks.length).toBe(3);
    expect(chunks[0].delta).toBe('Hello');
    expect(chunks[2].finishReason).toBe('stop');
  });

  it('chat respects abort', async () => {
    const ac = new AbortController();
    mockInstances.push({
      chat: { completions: {
        create: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < 10; i++) {
              if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
              yield { choices: [{ delta: { content: `chunk${i}` } }] };
              await new Promise(r => setTimeout(r, 50));
            }
          },
        }),
      }},
      models: { list: vi.fn() },
    });

    const { OpenAIProvider } = await import('../../../src/main/providers/openai');
    const p = new OpenAIProvider('openai', 'cfg-oai', 'sk-test');
    const chunks: any[] = [];
    setTimeout(() => ac.abort(), 100);
    for await (const c of p.chat({ model: 'gpt-4', messages: [] }, ac.signal)) chunks.push(c);
    expect(chunks.length).toBeLessThan(10);
  });
});

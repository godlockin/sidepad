import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registry } from '@main/providers';
import type { LLMProvider, Model, ChatRequest, ChatChunk } from '@main/providers/types';
import { ProviderError, normalizeError } from '@main/providers/errors';

// --- Helper: create a mock provider ---
function createMockProvider(overrides?: Partial<LLMProvider>): LLMProvider {
  return {
    id: 'mock',
    configId: 'mock-1',
    listModels: async (): Promise<Model[]> => [{ id: 'm1', name: 'Mock Model', contextWindow: 8192 }],
    async *chat(_req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      for (const chunk of ['Hello', ' ', 'World']) {
        if (signal.aborted) return;
        yield { delta: chunk };
      }
      yield { finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 3 } };
    },
    ...overrides,
  };
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    registry['providers'].clear();
    registry['listeners'].clear();
  });

  it('throws when getting an unknown provider', () => {
    expect(() => registry.get('nonexistent')).toThrow('Provider "nonexistent" not found');
  });

  it('returns a registered provider', () => {
    const p = createMockProvider();
    registry.register(p);
    expect(registry.get('mock')).toBe(p);
  });

  it('lists all registered providers', () => {
    const a = createMockProvider({ id: 'a', configId: 'a-1' });
    const b = createMockProvider({ id: 'b', configId: 'b-1' });
    registry.register(a);
    registry.register(b);
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('unregister and re-register', () => {
    const p = createMockProvider();
    registry.register(p);
    expect(registry.has('mock')).toBe(true);
    registry.unregister('mock');
    expect(registry.has('mock')).toBe(false);
    registry.register(p);
    expect(registry.has('mock')).toBe(true);
    expect(registry.get('mock')).toBe(p);
  });

  it('emits change events on register and unregister', () => {
    const listener = vi.fn();
    registry.onProviderChanged(listener);
    registry.register(createMockProvider());
    expect(listener).toHaveBeenCalledWith('registered', 'mock');
    registry.unregister('mock');
    expect(listener).toHaveBeenCalledWith('unregistered', 'mock');
  });

  it('mock provider streams chunks and respects abort', async () => {
    const p = createMockProvider();
    registry.register(p);
    const controller = new AbortController();
    const req: ChatRequest = {
      model: 'm1',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const chunks: ChatChunk[] = [];
    const iter = registry.get('mock').chat(req, controller.signal);
    for await (const c of iter) {
      chunks.push(c);
      if (c.delta === ' ') controller.abort();
    }
    // After abort mid-stream, we should have received at most 2 chunks
    expect(chunks.length).toBeLessThanOrEqual(2);
  });
});

describe('ProviderError', () => {
  it('creates a ProviderError with code and retriable flag', () => {
    const err = new ProviderError('AUTH_FAILED', 'Bad token', { retriable: false });
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).toBe('Bad token');
    expect(err.retriable).toBe(false);
  });

  it('defaults retriable based on code', () => {
    const retriable = new ProviderError('RATE_LIMITED', 'Too many requests');
    expect(retriable.retriable).toBe(true);

    const notRetriable = new ProviderError('MODEL_NOT_FOUND', 'Unknown model');
    expect(notRetriable.retriable).toBe(false);
  });
});

describe('normalizeError', () => {
  it('wraps a plain Error as UNKNOWN', () => {
    const err = new Error('something broke');
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(ProviderError);
    expect((normalized as ProviderError).code).toBe('UNKNOWN');
  });

  it('passes through ProviderError unchanged', () => {
    const original = new ProviderError('AUTH_FAILED', 'Bad token', { retriable: false });
    const result = normalizeError(original);
    expect(result).toBe(original);
  });

  it('maps known error messages to correct codes', () => {
    const rateLimitErr = new Error('429 Too Many Requests');
    expect((normalizeError(rateLimitErr) as ProviderError).code).toBe('RATE_LIMITED');

    const authErr = new Error('401 Unauthorized');
    expect((normalizeError(authErr) as ProviderError).code).toBe('AUTH_FAILED');

    const modelErr = new Error('model not found');
    expect((normalizeError(modelErr) as ProviderError).code).toBe('MODEL_NOT_FOUND');
  });
});

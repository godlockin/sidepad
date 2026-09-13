import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '../../../src/main/providers/ollama';
import { Ollama } from 'ollama';

vi.mock('ollama', () => ({
  default: { configure: vi.fn(), list: vi.fn(async () => ({ models: [] })), chat: vi.fn() },
  // Constructable mock: the provider does `new Ollama({ host })` for custom baseURLs.
  Ollama: vi.fn(function (this: Record<string, unknown>) {
    this.list = vi.fn(async () => ({ models: [] }));
    this.chat = vi.fn();
  }),
}));

describe('OllamaProvider', () => {
  it('creates with id and configId', () => {
    const p = new OllamaProvider('ollama', 'cfg-oll');
    expect(p.id).toBe('ollama');
    expect(p.configId).toBe('cfg-oll');
  });

  it('configures baseURL', () => {
    new OllamaProvider('ollama', 'cfg-oll', 'http://localhost:11435');
    expect(vi.mocked(Ollama)).toHaveBeenCalledWith({ host: 'http://localhost:11435' });
  });
});

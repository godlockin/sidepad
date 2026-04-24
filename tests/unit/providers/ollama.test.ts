import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '../../../src/main/providers/ollama';
import ollama from 'ollama';

vi.mock('ollama', () => ({ default: { configure: vi.fn(), list: vi.fn(), chat: vi.fn() } }));

describe('OllamaProvider', () => {
  it('creates with id and configId', () => {
    const p = new OllamaProvider('ollama', 'cfg-oll');
    expect(p.id).toBe('ollama');
    expect(p.configId).toBe('cfg-oll');
  });

  it('configures baseURL', () => {
    new OllamaProvider('ollama', 'cfg-oll', 'http://localhost:11435');
    expect(vi.mocked(ollama).configure).toHaveBeenCalledWith({ host: 'http://localhost:11435' });
  });
});

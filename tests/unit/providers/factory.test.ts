import { describe, it, expect, vi } from 'vitest';
import { loadProviders } from '../../../src/main/providers/factory';
import { ProviderRegistry } from '../../../src/main/providers';

describe('loadProviders', () => {
  it('registers enabled providers with secrets', () => {
    const reg = new ProviderRegistry();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: () => [
          { id: 'openai', type: 'openai', enabled: 1, base_url: null },
          { id: 'ollama', type: 'ollama', enabled: 1, base_url: null },
        ],
      }),
    };
    const mockSecrets = { get: vi.fn().mockReturnValue('sk-test') };

    loadProviders(mockDb as any, mockSecrets as any, reg);

    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id)).toEqual(['openai', 'ollama']);
  });

  it('skips disabled providers', () => {
    const reg = new ProviderRegistry();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: () => [{ id: 'anthropic', type: 'anthropic', enabled: 0 }],
      }),
    };
    loadProviders(mockDb as any, { get: vi.fn() } as any, reg);
    expect(reg.list()).toHaveLength(0);
  });

  it('skips openai-compat without baseURL', () => {
    const reg = new ProviderRegistry();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: () => [{ id: 'glm', type: 'openai-compat', enabled: 1, base_url: null }],
      }),
    };
    loadProviders(mockDb as any, { get: vi.fn().mockReturnValue('sk') } as any, reg);
    expect(reg.list()).toHaveLength(0);
  });

  it('skips _classifier config', () => {
    const reg = new ProviderRegistry();
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: () => [{ id: '_classifier', type: 'openai', enabled: 1, base_url: null }],
      }),
    };
    loadProviders(mockDb as any, { get: vi.fn().mockReturnValue('sk') } as any, reg);
    expect(reg.list()).toHaveLength(0);
  });
});

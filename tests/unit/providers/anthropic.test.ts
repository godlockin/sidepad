import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../../../src/main/providers/anthropic';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any, _config: any) {
    this.messages = { stream: vi.fn(), create: vi.fn() };
    this.models = { list: vi.fn() };
  };
  return { default: MockAnthropic };
});

describe('AnthropicProvider', () => {
  it('creates with id and configId', () => {
    const p = new AnthropicProvider('anthropic', 'cfg-ant', 'sk-ant-test');
    expect(p.id).toBe('anthropic');
    expect(p.configId).toBe('cfg-ant');
  });
});

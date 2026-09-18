import { describe, it, expect, vi } from 'vitest';
import { AnthropicMessagesProvider } from '@main/providers/anthropic-messages';

// Mock the @anthropic-ai/sdk module
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any, opts: any) {
    // Capture options so the test can assert
    (globalThis as any).__anthropicOpts = opts;
    this.messages = { stream: vi.fn() };
    this.models = { list: vi.fn().mockResolvedValue({ data: [] }) };
  };
  return { default: MockAnthropic };
});

describe('AnthropicMessagesProvider', () => {
  it('passes baseURL to SDK constructor', () => {
    new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://api.example.com', {});
    expect((globalThis as any).__anthropicOpts).toMatchObject({
      apiKey: 'key',
      baseURL: 'https://api.example.com',
    });
  });

  it('returns guess-list when listModels is called without a real endpoint', async () => {
    const p = new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://api.example.com', {});
    const models = await p.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => typeof m.id === 'string')).toBe(true);
  });

  it('capabilities: vision and reasoning for known Claude model ids', () => {
    const p = new AnthropicMessagesProvider('id', 'cfg', 'key', 'https://x', {});
    const caps = p.capabilities('claude-sonnet-4-5');
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.tools).toBe(true);
  });
});

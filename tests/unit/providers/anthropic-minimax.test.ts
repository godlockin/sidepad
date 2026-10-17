import { describe, it, expect, vi } from 'vitest';
import {
  AnthropicMinimaxProvider,
  MINIMAX_ANTHROPIC_BASE_URL,
} from '@main/providers/vendors/anthropic-minimax';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any, opts: any) {
    (globalThis as any).__anthropicOpts = opts;
    this.messages = { stream: vi.fn() };
  };
  return { default: MockAnthropic };
});

describe('AnthropicMinimaxProvider', () => {
  it('defaults to MiniMax Anthropic base URL', () => {
    new AnthropicMinimaxProvider('id', 'cfg', 'key');
    expect((globalThis as any).__anthropicOpts).toMatchObject({
      apiKey: 'key',
      baseURL: MINIMAX_ANTHROPIC_BASE_URL,
    });
  });

  it('lists MiniMax model guesses', async () => {
    const p = new AnthropicMinimaxProvider('id', 'cfg', 'key');
    const models = await p.listModels();
    expect(models.some((m) => m.id.includes('MiniMax'))).toBe(true);
  });

  it('marks M3 as vision+reasoning', () => {
    const p = new AnthropicMinimaxProvider('id', 'cfg', 'key');
    const caps = p.capabilities('MiniMax-M3');
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { parseProviderParams, mergeOverrides } from '@main/providers/overrides';
import type { ChatRequest } from '@main/providers/types';

describe('provider config flow', () => {
  it('persists and reads back extraHeaders/extraBody/modelOverrides', () => {
    const input = {
      defaultModel: 'claude-sonnet-4-5',
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: 42 },
      modelOverrides: {
        'claude-sonnet-4-5': { thinkingBudget: 8192 },
      },
    };
    const json = JSON.stringify(input);
    const parsed = parseProviderParams(json);
    expect(parsed).toEqual(input);
  });

  it('merged output reaches SDK options correctly', () => {
    const req: ChatRequest = {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
    };
    const params = parseProviderParams(JSON.stringify({
      extraHeaders: { 'X-A': '1' },
      extraBody: { top_p: 0.9 },
      modelOverrides: {
        'claude-sonnet-4-5': { temperature: 0.3, extraBody: { top_p: 0.8 } },
      },
    }));
    const merged = mergeOverrides(req, params);
    expect(merged.headers).toEqual({ 'X-A': '1' });
    // runtime req.temperature wins over modelOverride.temperature
    expect(merged.body.temperature).toBe(0.5);
    // modelOverride.extraBody beats provider.extraBody
    expect((merged.body as any).top_p).toBe(0.8);
  });

  it('corrupted params_json returns empty params', () => {
    expect(parseProviderParams('not-json{')).toEqual({});
    expect(parseProviderParams('{')).toEqual({});
  });
});

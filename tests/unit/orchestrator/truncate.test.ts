import { describe, it, expect } from 'vitest';
import { truncateContext, estimateTokens } from '../../../src/main/orchestrator/truncate';

describe('truncate', () => {
  it('estimates tokens for ASCII', () => {
    expect(estimateTokens('hello world')).toBeCloseTo(3, 0);
  });
  it('estimates tokens for CJK', () => {
    expect(estimateTokens('你好世界')).toBeGreaterThanOrEqual(2);
  });
  it('truncates oldest messages when over limit', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'old1' },
      { role: 'assistant' as const, content: 'old2' },
      { role: 'user' as const, content: 'current' },
    ];
    const result = truncateContext(messages, 20, 100);
    expect(result.messages.length).toBeLessThanOrEqual(messages.length);
    // no duplication: each original content appears at most once
    const contents = result.messages.map((m) => m.content);
    expect(new Set(contents).size).toBe(contents.length);
  });
  it('retains system + current turn', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'current turn' },
    ];
    const result = truncateContext(messages, 1, 100);
    expect(result.messages.some(m => m.role === 'system')).toBe(true);
    expect(result.messages.some(m => m.content === 'current turn')).toBe(true);
  });
  it('never duplicates the pinned last user turns when over budget', () => {
    const big = 'x'.repeat(400); // ~100 tokens each
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: `u1 ${big}` },
      { role: 'assistant' as const, content: `a1 ${big}` },
      { role: 'user' as const, content: `u2 ${big}` },
      { role: 'assistant' as const, content: `a2 ${big}` },
      { role: 'user' as const, content: 'current question' },
    ];
    const result = truncateContext(messages, 120, 200);
    const contents = result.messages.map((m) => m.content);
    expect(new Set(contents).size).toBe(contents.length);
    // the current question survives
    expect(contents).toContain('current question');
    // chronological order preserved
    const order = contents.map((c) => messages.findIndex((m) => m.content === c));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

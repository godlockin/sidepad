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
});

import { describe, it, expect } from 'vitest';
import { buildContext } from '../../../src/main/orchestrator/context-builder';

describe('buildContext', () => {
  it('independent: only agent history', () => {
    const history = [
      { role: 'user' as const, content: 'turn1', agentId: 'a' },
      { role: 'assistant' as const, content: 'reply1', agentId: 'a' },
      { role: 'user' as const, content: 'turn1', agentId: 'b' },
      { role: 'assistant' as const, content: 'reply1b', agentId: 'b' },
    ];
    const ctx = buildContext({
      history, agentId: 'a', visibilityMode: 'independent',
      systemPrompt: 'sys', currentTurn: [{ role: 'user' as const, content: 'new' }],
      modelContextWindow: 8000,
    });
    expect(ctx.messages.some(m => m.role === 'system')).toBe(true);
    expect(ctx.messages.filter(m => m.role === 'assistant').length).toBeLessThanOrEqual(1);
  });
  it('full: all history', () => {
    const history = [
      { role: 'user' as const, content: 't1', agentId: 'a' },
      { role: 'assistant' as const, content: 'r1', agentId: 'a' },
      { role: 'user' as const, content: 't1', agentId: 'b' },
      { role: 'assistant' as const, content: 'r1b', agentId: 'b' },
    ];
    const ctx = buildContext({
      history, agentId: 'a', visibilityMode: 'full',
      systemPrompt: 'sys', currentTurn: [{ role: 'user' as const, content: 'new' }],
      modelContextWindow: 8000,
    });
    expect(ctx.messages.length).toBeGreaterThan(3);
  });
});

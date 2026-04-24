import { describe, it, expect, vi } from 'vitest';
import { ClassifierAgent } from '../../../src/main/orchestrator/classifier';

describe('ClassifierAgent', () => {
  it('returns disabled when not configured', () => {
    const agent = new ClassifierAgent({ enabled: false, providerId: '', model: '', timeoutMs: 3000, threshold: 0.6 }, null as any);
    expect(agent.isEnabled()).toBe(false);
  });

  it('classifies with mock provider', async () => {
    const mockProvider = {
      chat: vi.fn().mockImplementation(async function* () {
        yield { delta: JSON.stringify({ mode: 'lead-and-comment', leadAgentId: 'a', commenterAgentIds: ['b'], confidence: 0.9 }) };
      }),
    };

    const agent = new ClassifierAgent({ enabled: true, providerId: 'openai', model: 'gpt-4o-mini', timeoutMs: 3000, threshold: 0.6 }, mockProvider as any);
    const result = await agent.classify({
      text: 'you lead this discussion',
      mentions: [{ agentId: 'a', displayName: 'A', role: 'lead' }, { agentId: 'b', displayName: 'B', role: 'commenter' }],
      triggerHints: { leadMatched: true, commentMatched: false },
    });
    expect(result.mode).toBe('lead-and-comment');
    expect(result.confidence).toBe(0.9);
  });

  it('throws when not enabled', async () => {
    const agent = new ClassifierAgent({ enabled: false, providerId: '', model: '', timeoutMs: 3000, threshold: 0.6 }, null as any);
    await expect(agent.classify({ text: 'hello', mentions: [], triggerHints: { leadMatched: false, commentMatched: false } })).rejects.toThrow();
  });
});

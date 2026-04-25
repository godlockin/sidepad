import { describe, it, expect } from 'vitest';
import { resolveMode } from '../../../src/main/orchestrator/mode-resolver';

interface Session {
  id: string; title: string; createdAt: number; updatedAt: number;
  systemPrompt: string | null; visibilityMode: 'independent' | 'full';
  groupMode: 'parallel' | 'relay'; defaultAgentId: string | null;
  participants: string[]; folderId: string | null; projectId: string | null;
  pinned: boolean; archived: boolean; parentMessageId: string | null;
}
function makeSession(ov: Partial<Session> = {}): Session {
  return {
    id: 's1', title: 'Test', createdAt: 0, updatedAt: 0, systemPrompt: null,
    visibilityMode: 'independent', groupMode: 'parallel', defaultAgentId: null,
    participants: ['a', 'b', 'c'], folderId: null, projectId: null,
    pinned: false, archived: false, parentMessageId: null, ...ov,
  };
}

describe('resolveMode', () => {
  it('0 mentions, default set → single', () => {
    const r = resolveMode(makeSession({ defaultAgentId: 'a' }), '', []);
    expect(r.mode).toBe('single'); expect(r.agentIds).toEqual(['a']);
  });
  it('0 mentions, no default → error', () => {
    const r = resolveMode(makeSession(), '', []);
    expect(r.mode).toBe('error'); expect(r.errorCode).toBe('NO_DEFAULT_AGENT');
  });
  it('1 mention + lead verb → lead-and-comment', () => {
    const r = resolveMode(makeSession(), '你来主答', ['a']);
    expect(r.mode).toBe('lead-and-comment'); expect(r.leadAgentId).toBe('a');
  });
  it('1 mention, no lead → single', () => {
    const r = resolveMode(makeSession(), 'hello', ['a']);
    expect(r.mode).toBe('single'); expect(r.agentIds).toEqual(['a']);
  });
  it('2+ mentions, lead match → lead-and-comment', () => {
    const r = resolveMode(makeSession(), '你先回答', ['a', 'b']);
    expect(r.mode).toBe('lead-and-comment'); expect(r.leadAgentId).toBe('a');
  });
  it('2+ mentions, no lead → relay (directed sequential, default)', () => {
    const r = resolveMode(makeSession({ groupMode: 'parallel' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('relay');
  });
  it('classifier result overrides when confident', () => {
    const r = resolveMode(makeSession(), 'hello', ['a', 'b', 'c'],
      { mode: 'lead-and-comment', leadAgentId: 'b', commenterAgentIds: ['a', 'c'], confidence: 0.8 });
    expect(r.mode).toBe('lead-and-comment'); expect(r.leadAgentId).toBe('b');
  });
  it('classifier low confidence falls back to rules → relay default for 2+ mentions', () => {
    const r = resolveMode(makeSession({ groupMode: 'parallel' }), 'hello', ['a', 'b'],
      { mode: 'lead-and-comment', leadAgentId: 'a', confidence: 0.3 });
    expect(r.mode).toBe('relay');
  });
});

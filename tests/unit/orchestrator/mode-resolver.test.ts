import { describe, it, expect } from 'vitest';
import { resolveMode } from '../../../src/main/orchestrator/mode-resolver';
import type { GroupMode } from '../../../src/shared/types/session';

interface Session {
  id: string; title: string; createdAt: number; updatedAt: number;
  systemPrompt: string | null; visibilityMode: 'independent' | 'full';
  groupMode: GroupMode; defaultAgentId: string | null;
  participants: string[]; folderId: string | null; projectId: string | null;
  pinned: boolean; archived: boolean; parentMessageId: string | null;
}
function makeSession(ov: Partial<Session> = {}): Session {
  return {
    id: 's1', title: 'Test', createdAt: 0, updatedAt: 0, systemPrompt: null,
    visibilityMode: 'independent', groupMode: 'auto', defaultAgentId: null,
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
    const r = resolveMode(makeSession({ groupMode: 'auto' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('relay');
  });
  it('2+ mentions, roundtable trigger phrase → roundtable', () => {
    const r = resolveMode(makeSession({ groupMode: 'auto' }), '我们圆桌讨论一下', ['a', 'b']);
    expect(r.mode).toBe('roundtable'); expect(r.agentIds).toEqual(['a', 'b']);
  });
  it('2+ mentions, English roundtable trigger → roundtable', () => {
    const r = resolveMode(makeSession(), "let's discuss this together", ['a', 'b', 'c']);
    expect(r.mode).toBe('roundtable');
  });
  it('explicit groupMode roundtable overrides relay default', () => {
    const r = resolveMode(makeSession({ groupMode: 'roundtable' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('roundtable');
  });
  it('explicit groupMode parallel overrides relay default', () => {
    const r = resolveMode(makeSession({ groupMode: 'parallel' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('parallel');
  });
  it('explicit groupMode relay is honored', () => {
    const r = resolveMode(makeSession({ groupMode: 'relay' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('relay');
  });
  it('explicit groupMode lead-and-comment with no trigger → first mention leads', () => {
    const r = resolveMode(makeSession({ groupMode: 'lead-and-comment' }), 'hello', ['a', 'b']);
    expect(r.mode).toBe('lead-and-comment');
    expect(r.leadAgentId).toBe('a');
    expect(r.commenterAgentIds).toEqual(['b']);
  });
  it('lead trigger beats explicit groupMode', () => {
    const r = resolveMode(makeSession({ groupMode: 'roundtable' }), '你先回答', ['a', 'b']);
    expect(r.mode).toBe('lead-and-comment');
  });
  it('classifier result overrides when confident', () => {
    const r = resolveMode(makeSession(), 'hello', ['a', 'b', 'c'],
      { mode: 'lead-and-comment', leadAgentId: 'b', commenterAgentIds: ['a', 'c'], confidence: 0.8 });
    expect(r.mode).toBe('lead-and-comment'); expect(r.leadAgentId).toBe('b');
  });
  it('classifier low confidence falls back to rules → relay default for 2+ mentions', () => {
    const r = resolveMode(makeSession({ groupMode: 'auto' }), 'hello', ['a', 'b'],
      { mode: 'lead-and-comment', leadAgentId: 'a', confidence: 0.3 });
    expect(r.mode).toBe('relay');
  });
  it('confident classifier roundtable is honored', () => {
    const r = resolveMode(makeSession(), 'hello', ['a', 'b'],
      { mode: 'roundtable', confidence: 0.9 });
    expect(r.mode).toBe('roundtable');
  });
});

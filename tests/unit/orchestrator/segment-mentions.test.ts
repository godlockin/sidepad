import { describe, it, expect } from 'vitest';
import { segmentByMentions } from '../../../src/main/orchestrator/segment-mentions';

describe('segmentByMentions', () => {
  it('prefix-only (no mentions)', () => {
    const r = segmentByMentions('just a message', []);
    expect(r.prefix).toBe('just a message');
    expect(r.parts).toEqual([]);
  });

  it('single mention with text → one part, prefix empty', () => {
    const r = segmentByMentions('@a hello world', ['a']);
    expect(r.prefix).toBe('');
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toEqual({ agentId: 'a', segment: '@a hello world' });
  });

  it('three-way (worked example)', () => {
    const text = '@o-l 它说它是智能助手，你觉得呢？@o-q 你来评价一下。@az-openai 他们说的对吗';
    const r = segmentByMentions(text, ['o-l', 'o-q', 'az-openai']);
    expect(r.prefix).toBe('');
    expect(r.parts).toEqual([
      { agentId: 'o-l', segment: '@o-l 它说它是智能助手，你觉得呢？' },
      { agentId: 'o-q', segment: '@o-q 你来评价一下。' },
      { agentId: 'az-openai', segment: '@az-openai 他们说的对吗' },
    ]);
  });

  it('mention with no following text', () => {
    const r = segmentByMentions('@a @b talk', ['a', 'b']);
    expect(r.prefix).toBe('');
    expect(r.parts).toEqual([
      { agentId: 'a', segment: '@a' },
      { agentId: 'b', segment: '@b talk' },
    ]);
  });

  it('Chinese punctuation around @', () => {
    const r = segmentByMentions('开头。@a 内容@b 后面', ['a', 'b']);
    expect(r.prefix).toBe('开头。');
    expect(r.parts).toEqual([
      { agentId: 'a', segment: '@a 内容' },
      { agentId: 'b', segment: '@b 后面' },
    ]);
  });

  it('whitespace: leading/trailing trimmed per segment', () => {
    const r = segmentByMentions('  @a   hi  @b   yo   ', ['a', 'b']);
    expect(r.prefix).toBe('');
    expect(r.parts).toEqual([
      { agentId: 'a', segment: '@a   hi' },
      { agentId: 'b', segment: '@b   yo' },
    ]);
  });

  it('drops mentions that do not appear in text', () => {
    const r = segmentByMentions('@a hello', ['a', 'ghost']);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].agentId).toBe('a');
  });

  it('returns prefix=text when none of the orderedMentions appear', () => {
    const r = segmentByMentions('just text', ['a']);
    expect(r.prefix).toBe('just text');
    expect(r.parts).toEqual([]);
  });
});

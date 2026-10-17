import { describe, it, expect } from 'vitest';
import { parseClassifierJson } from '@main/orchestrator/classifier';

describe('parseClassifierJson', () => {
  it('parses bare JSON', () => {
    const r = parseClassifierJson('{"mode":"parallel","confidence":0.9}');
    expect(r.mode).toBe('parallel');
    expect(r.confidence).toBe(0.9);
  });

  it('strips markdown fences and prose', () => {
    const r = parseClassifierJson('Sure:\n```json\n{"mode":"relay","confidence":0.8}\n```\n');
    expect(r.mode).toBe('relay');
  });

  it('rejects invalid shapes', () => {
    expect(() => parseClassifierJson('{"mode":"x"}')).toThrow();
  });
});

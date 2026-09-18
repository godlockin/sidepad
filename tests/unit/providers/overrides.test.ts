import { describe, it, expect } from 'vitest';
import { parseProviderParams, mergeOverrides } from '@main/providers/overrides';
import type { ChatRequest } from '@main/providers/types';

describe('parseProviderParams', () => {
  it('returns empty object for null', () => {
    expect(parseProviderParams(null)).toEqual({});
  });
  it('returns empty object for invalid JSON', () => {
    expect(parseProviderParams('not-json{')).toEqual({});
  });
  it('parses existing defaultModel shape', () => {
    expect(parseProviderParams('{"defaultModel":"claude-sonnet-4-5"}')).toEqual({
      defaultModel: 'claude-sonnet-4-5',
    });
  });
  it('parses extraHeaders/extraBody/modelOverrides', () => {
    const json = JSON.stringify({
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: true },
      modelOverrides: { 'claude-sonnet-4-5': { thinkingBudget: 8192 } },
    });
    expect(parseProviderParams(json)).toEqual({
      extraHeaders: { 'X-Custom': 'foo' },
      extraBody: { providerParam: true },
      modelOverrides: { 'claude-sonnet-4-5': { thinkingBudget: 8192 } },
    });
  });
});

describe('mergeOverrides', () => {
  const req: ChatRequest = {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7,
  };
  it('passes through when params empty', () => {
    const { headers, body } = mergeOverrides(req, {});
    expect(headers).toEqual({});
    expect(body).toEqual({ temperature: 0.7 });
  });
  it('provider-level extraHeaders applied', () => {
    const { headers } = mergeOverrides(req, { extraHeaders: { 'X-A': '1' } });
    expect(headers).toEqual({ 'X-A': '1' });
  });
  it('per-model overrides beat provider-level', () => {
    const { headers, body } = mergeOverrides(req, {
      extraHeaders: { 'X-A': '1' },
      modelOverrides: { 'claude-sonnet-4-5': { extraHeaders: { 'X-A': '2' } } },
    });
    expect(headers).toEqual({ 'X-A': '2' });
  });
  it('chatRequest fields win over overrides', () => {
    const { body } = mergeOverrides(req, {
      extraBody: { temperature: 0.5 },
    });
    expect(body.temperature).toBe(0.7);
  });
});

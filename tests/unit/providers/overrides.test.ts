import { describe, it, expect } from 'vitest';
import {
  parseProviderParams,
  mergeOverrides,
  sanitizeHeaders,
  sanitizeBody,
  normalizeThinkingBudget,
  THINKING_BUDGET_MIN,
  THINKING_BUDGET_MAX,
} from '@main/providers/overrides';
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
    const { headers } = mergeOverrides(req, {
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
  it('strips protected body keys from extraBody', () => {
    const { body } = mergeOverrides(req, {
      extraBody: {
        model: 'hijacked',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        tools: [],
        thinking: { type: 'enabled', budget_tokens: 1 },
        top_p: 0.9,
      },
    });
    expect(body.model).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.top_p).toBe(0.9);
  });
  it('strips reserved headers case-insensitively', () => {
    const { headers } = mergeOverrides(req, {
      extraHeaders: {
        Authorization: 'Bearer stolen',
        'X-Api-Key': 'secret',
        'X-Custom': 'ok',
      },
    });
    expect(headers).toEqual({ 'X-Custom': 'ok' });
  });
  it('clamps thinkingBudget from modelOverrides', () => {
    const { body } = mergeOverrides(req, {
      modelOverrides: { 'claude-sonnet-4-5': { thinkingBudget: 1e9 } },
    });
    expect(body.thinkingBudget).toBe(THINKING_BUDGET_MAX);
  });
});

describe('sanitizeHeaders / sanitizeBody / normalizeThinkingBudget', () => {
  it('drops hop-by-hop and auth headers', () => {
    expect(
      sanitizeHeaders({
        authorization: 'x',
        Cookie: 'a=b',
        Host: 'evil',
        'X-Trace': '1',
      }),
    ).toEqual({ 'X-Trace': '1' });
  });
  it('drops protected body keys case-insensitively', () => {
    expect(
      sanitizeBody({
        Model: 'x',
        SystemInstruction: 'y',
        topP: 0.5,
      }),
    ).toEqual({ topP: 0.5 });
  });
  it('rejects non-numeric thinkingBudget', () => {
    expect(sanitizeBody({ thinkingBudget: 'lots' as unknown as number })).toEqual({});
    expect(normalizeThinkingBudget('x')).toBeUndefined();
    expect(normalizeThinkingBudget(NaN)).toBeUndefined();
  });
  it('clamps thinkingBudget to inclusive range', () => {
    expect(normalizeThinkingBudget(1)).toBe(THINKING_BUDGET_MIN);
    expect(normalizeThinkingBudget(5000.9)).toBe(5000);
    expect(normalizeThinkingBudget(999_999)).toBe(THINKING_BUDGET_MAX);
  });
});

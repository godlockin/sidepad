import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedChat {
  config?: Record<string, unknown>;
}
interface CapturedSend {
  message?: unknown;
  config?: Record<string, unknown>;
}

let capturedChat: CapturedChat | null = null;
let capturedSend: CapturedSend | null = null;

vi.mock('@google/genai', () => {
  const MockGoogleGenAI = function (this: { models: unknown; chats: unknown }, opts: unknown) {
    (globalThis as Record<string, unknown>).__geminiOpts = opts;
    this.models = {
      list: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1000000 };
        },
        page: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1000000 }],
      }),
    };
    this.chats = {
      create: (params: CapturedChat) => {
        capturedChat = params;
        return {
          sendMessageStream: async (sendParams: CapturedSend) => {
            capturedSend = sendParams;
            return {
              async *[Symbol.asyncIterator]() {
                yield { candidates: [{ content: { parts: [{ text: 'hi' }] } }] };
                yield { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } };
              },
            };
          },
        };
      },
    };
  };
  return { GoogleGenAI: MockGoogleGenAI };
});

beforeEach(() => {
  capturedChat = null;
  capturedSend = null;
});

import { GeminiProvider } from '../../../src/main/providers/gemini';
import type { ChatRequest } from '../../../src/main/providers/types';

describe('GeminiProvider', () => {
  it('passes apiKey to SDK constructor', () => {
    new GeminiProvider('id', 'cfg', 'key', undefined, {});
    expect((globalThis as Record<string, unknown>).__geminiOpts).toMatchObject({ apiKey: 'key' });
  });

  it('passes baseURL via httpOptions.baseUrl', () => {
    new GeminiProvider('id', 'cfg', 'key', 'https://custom.api/', {});
    expect((globalThis as Record<string, unknown>).__geminiOpts).toMatchObject({
      apiKey: 'key',
      httpOptions: { baseUrl: 'https://custom.api/' },
    });
  });

  it('listModels returns non-empty array', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const models = await p.listModels();
    expect(models.length).toBeGreaterThan(0);
    const m = models[0];
    expect(m.id).toBeTruthy();
    expect(m.name).toBeTruthy();
    expect(typeof m.contextWindow).toBe('number');
  });

  it('chat yields delta + finish chunks', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const req: ChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const chunks: unknown[] = [];
    for await (const c of p.chat(req, new AbortController().signal)) chunks.push(c);
    expect(chunks.some((c: unknown) => (c as Record<string, unknown>).delta === 'hi')).toBe(true);
    const last = chunks[chunks.length - 1] as Record<string, unknown>;
    expect(last.finishReason).toBe('stop');
    expect(last.usage).toBeDefined();
  });

  it('capabilities: vision for Gemini models', () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const caps = p.capabilities('gemini-2.5-pro');
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
  });

  it('capabilities: reasoning for gemini-2.5 models', () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const caps = p.capabilities('gemini-2.5-flash');
    expect(caps.reasoning).toBe(true);
  });

  it('capabilities: no reasoning for gemini-2.0', () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const caps = p.capabilities('gemini-2.0-flash');
    expect(caps.reasoning).toBe(false);
  });

  it('chat forwards extraHeaders via httpOptions to chats.create config', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {
      extraHeaders: { 'X-Custom-Header': 'custom-value' },
    });
    const req: ChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    };
    for await (const _ of p.chat(req, new AbortController().signal)) { /* consume */ }
    expect(capturedChat).not.toBeNull();
    const config = (capturedChat as CapturedChat).config as Record<string, unknown> | undefined;
    expect(config?.httpOptions).toEqual({ headers: { 'X-Custom-Header': 'custom-value' } });
  });

  it('chat forwards abortSignal to sendMessageStream config', async () => {
    const p = new GeminiProvider('id', 'cfg', 'key', undefined, {});
    const req: ChatRequest = {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const controller = new AbortController();
    for await (const _ of p.chat(req, controller.signal)) { /* consume */ }
    expect(capturedSend).not.toBeNull();
    const sendConfig = (capturedSend as CapturedSend).config as Record<string, unknown> | undefined;
    expect(sendConfig?.abortSignal).toBe(controller.signal);
  });
});

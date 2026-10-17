import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any) {
    this.messages = { stream: vi.fn() };
  };
  return { default: MockAnthropic };
});

vi.mock('@anthropic-ai/bedrock-sdk', () => {
  const MockBedrock = function (this: any, opts: any) {
    (globalThis as any).__bedrockOpts = opts;
    this.messages = { stream: vi.fn() };
  };
  return { default: MockBedrock };
});

import { AnthropicBedrockProvider } from '@main/providers/vendors/anthropic-bedrock';
import { parseBedrockCredential, parseBedrockEndpoint } from '@main/providers/vendors/bedrock-credentials';

describe('parseBedrockCredential', () => {
  it('treats a single line as a bearer token', () => {
    expect(parseBedrockCredential('bedrock-token')).toEqual({ apiKey: 'bedrock-token' });
  });

  it('reads access key lines', () => {
    expect(parseBedrockCredential('AKIAEXAMPLE\nsecretvalue\nsession')).toEqual({
      awsAccessKey: 'AKIAEXAMPLE',
      awsSecretKey: 'secretvalue',
      awsSessionToken: 'session',
    });
  });

  it('reads JSON', () => {
    expect(
      parseBedrockCredential('{"accessKeyId":"A","secretAccessKey":"S"}'),
    ).toEqual({ awsAccessKey: 'A', awsSecretKey: 'S' });
  });

  it('empty means the default chain', () => {
    expect(parseBedrockCredential('')).toEqual({});
  });
});

describe('parseBedrockEndpoint', () => {
  it('defaults region', () => {
    expect(parseBedrockEndpoint('')).toEqual({ awsRegion: 'us-east-1' });
  });

  it('accepts a region code', () => {
    expect(parseBedrockEndpoint('eu-west-1')).toEqual({ awsRegion: 'eu-west-1' });
  });

  it('parses region from a runtime URL', () => {
    expect(parseBedrockEndpoint('https://bedrock-runtime.ap-northeast-1.amazonaws.com')).toEqual({
      awsRegion: 'ap-northeast-1',
      baseURL: 'https://bedrock-runtime.ap-northeast-1.amazonaws.com',
    });
  });

  it('rejects a non-region string', () => {
    expect(() => parseBedrockEndpoint('not a region')).toThrow(/invalid Bedrock region/);
  });
});

describe('AnthropicBedrockProvider', () => {
  it('passes region and static keys to the Bedrock client', () => {
    new AnthropicBedrockProvider('id', 'cfg', 'AKIATEST\nwjalrXUtnFEMI', 'us-west-2');
    expect((globalThis as any).__bedrockOpts).toMatchObject({
      awsRegion: 'us-west-2',
      awsAccessKey: 'AKIATEST',
      awsSecretKey: 'wjalrXUtnFEMI',
    });
  });

  it('lists Claude model ids', async () => {
    const p = new AnthropicBedrockProvider('id', 'cfg', '', 'us-east-1');
    const models = await p.listModels();
    expect(models.some((m) => m.id.includes('claude'))).toBe(true);
    expect(models[0]?.caps?.tools).toBe(true);
  });
});

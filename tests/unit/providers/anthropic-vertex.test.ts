import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = function (this: any) {
    this.messages = { stream: vi.fn() };
  };
  return { default: MockAnthropic };
});

vi.mock('@anthropic-ai/vertex-sdk', () => {
  const MockVertex = function (this: any, opts: any) {
    (globalThis as any).__vertexOpts = opts;
    this.messages = { stream: vi.fn() };
  };
  return { default: MockVertex };
});

vi.mock('google-auth-library', () => ({
  GoogleAuth: function (this: any, opts: any) {
    (globalThis as any).__googleAuthOpts = opts;
  },
}));

import { AnthropicVertexProvider } from '@main/providers/vendors/anthropic-vertex';
import { parseVertexEndpoint } from '@main/providers/vendors/vertex-endpoint';

describe('parseVertexEndpoint', () => {
  it('parses project@region', () => {
    expect(parseVertexEndpoint('my-proj@us-east5')).toEqual({
      projectId: 'my-proj',
      region: 'us-east5',
    });
  });

  it('parses project:region', () => {
    expect(parseVertexEndpoint('my-proj:global')).toEqual({
      projectId: 'my-proj',
      region: 'global',
    });
  });

  it('parses a Vertex URL', () => {
    expect(
      parseVertexEndpoint(
        'https://us-east5-aiplatform.googleapis.com/v1/projects/p1/locations/us-east5/publishers/anthropic',
      ),
    ).toEqual({ projectId: 'p1', region: 'us-east5' });
  });

  it('rejects empty', () => {
    expect(() => parseVertexEndpoint('')).toThrow(/baseURL required/);
  });
});

describe('AnthropicVertexProvider', () => {
  it('passes project and region with an access token', () => {
    new AnthropicVertexProvider('id', 'cfg', 'ya29.token', 'demo@us-east5');
    expect((globalThis as any).__vertexOpts).toMatchObject({
      projectId: 'demo',
      region: 'us-east5',
      accessToken: 'ya29.token',
    });
  });

  it('uses GoogleAuth for inline service-account JSON', () => {
    const json = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x' });
    new AnthropicVertexProvider('id', 'cfg', json, 'demo@us-east5');
    expect((globalThis as any).__googleAuthOpts).toMatchObject({
      credentials: { client_email: 'a@b.iam.gserviceaccount.com' },
    });
    expect((globalThis as any).__vertexOpts.projectId).toBe('demo');
  });

  it('lists Claude model ids', async () => {
    const p = new AnthropicVertexProvider('id', 'cfg', '', 'demo@us-east5');
    const models = await p.listModels();
    expect(models.some((m) => m.id.includes('claude'))).toBe(true);
  });
});

import { existsSync } from 'node:fs';
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { GoogleAuth } from 'google-auth-library';
import { AnthropicBaseProvider } from '../base/anthropic-base';
import type { Model } from '../types';
import type { ProviderParams } from '../overrides';
import { parseVertexEndpoint } from './vertex-endpoint';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Common Claude publisher model ids on Vertex AI. */
const DEFAULT_MODELS = [
  'claude-sonnet-4-5@20250929',
  'claude-opus-4-1@20250805',
  'claude-3-7-sonnet@20250219',
  'claude-3-5-sonnet-v2@20241022',
  'claude-3-5-haiku@20241022',
];

/**
 * Claude on Google Vertex AI. Auth via `@anthropic-ai/vertex-sdk`:
 * access token, service-account JSON (inline or path), or ADC when empty.
 *
 * `baseURL` is `projectId@region` (e.g. `my-gcp@us-east5`).
 */
export class AnthropicVertexProvider extends AnthropicBaseProvider {
  constructor(
    id: string,
    configId: string,
    secret: string,
    baseURL: string,
    parsedParams: ProviderParams = {},
  ) {
    super(id, configId, 'vertex-placeholder', {}, parsedParams);
    const endpoint = parseVertexEndpoint(baseURL);
    this.client = createVertexClient(endpoint.projectId, endpoint.region, secret) as unknown as typeof this.client;
  }

  async listModels(): Promise<Model[]> {
    return DEFAULT_MODELS.map((id) => ({
      id,
      name: id,
      contextWindow: 200_000,
      caps: this.capabilities(id),
    }));
  }
}

function createVertexClient(projectId: string, region: string, secret: string): AnthropicVertex {
  const common = { projectId, region };
  const text = (secret ?? '').trim();
  if (!text) {
    return new AnthropicVertex(common);
  }
  if (text.startsWith('{')) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return new AnthropicVertex({ ...common, accessToken: text });
    }
    return new AnthropicVertex({
      ...common,
      googleAuth: new GoogleAuth({
        credentials,
        scopes: CLOUD_PLATFORM_SCOPE,
      }),
    });
  }
  if ((text.endsWith('.json') || text.includes('/')) && existsSync(text)) {
    return new AnthropicVertex({
      ...common,
      googleAuth: new GoogleAuth({
        keyFile: text,
        scopes: CLOUD_PLATFORM_SCOPE,
      }),
    });
  }
  return new AnthropicVertex({ ...common, accessToken: text });
}

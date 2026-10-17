import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import { AnthropicBaseProvider } from '../base/anthropic-base';
import type { Model } from '../types';
import type { ProviderParams } from '../overrides';
import {
  parseBedrockCredential,
  parseBedrockEndpoint,
  type BedrockCredential,
} from './bedrock-credentials';

function createBedrockClient(
  endpoint: { awsRegion: string; baseURL?: string },
  creds: BedrockCredential,
): AnthropicBedrock {
  const common = {
    awsRegion: endpoint.awsRegion,
    ...(endpoint.baseURL ? { baseURL: endpoint.baseURL } : {}),
  };
  if (creds.apiKey) {
    return new AnthropicBedrock({ ...common, apiKey: creds.apiKey });
  }
  if (creds.awsAccessKey && creds.awsSecretKey) {
    return new AnthropicBedrock({
      ...common,
      awsAccessKey: creds.awsAccessKey,
      awsSecretKey: creds.awsSecretKey,
      ...(creds.awsSessionToken ? { awsSessionToken: creds.awsSessionToken } : {}),
    });
  }
  return new AnthropicBedrock(common);
}

/** Common Claude inference-profile / foundation-model ids on Bedrock. */
const DEFAULT_MODELS = [
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'us.anthropic.claude-opus-4-1-20250805-v1:0',
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
];

/**
 * Claude on Amazon Bedrock. Signing is handled by `@anthropic-ai/bedrock-sdk`
 * (bearer token, static keys, or the default AWS credential chain).
 *
 * `baseURL` is an AWS region (`us-east-1`) or a full runtime URL.
 * The secret is a bearer token, JSON, or access-key lines — see
 * `parseBedrockCredential`. An empty secret uses the local AWS chain.
 */
export class AnthropicBedrockProvider extends AnthropicBaseProvider {
  constructor(
    id: string,
    configId: string,
    secret: string,
    baseURL?: string,
    parsedParams: ProviderParams = {},
  ) {
    super(id, configId, 'bedrock-placeholder', {}, parsedParams);
    const endpoint = parseBedrockEndpoint(baseURL);
    const creds = parseBedrockCredential(secret);
    this.client = createBedrockClient(endpoint, creds) as unknown as typeof this.client;
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

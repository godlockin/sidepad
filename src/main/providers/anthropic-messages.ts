import { AnthropicBaseProvider } from './base/anthropic-base';
import type { Model } from './types';
import { inferCaps } from './caps-heuristics';
import type { ProviderParams } from './overrides';

/**
 * Generic Anthropic Messages-compatible provider.
 *
 * Use baseURL to point at any vendor that exposes the Anthropic Messages
 * protocol (e.g. Minimax, self-hosted proxies). SDK auth header is
 * forwarded; vendors needing custom auth (AWS SigV4, GCP tokens) are not
 * supported by this class — implement a vendor subclass instead.
 */
export class AnthropicMessagesProvider extends AnthropicBaseProvider {
  constructor(id: string, configId: string, apiKey: string, baseURL: string, parsedParams: ProviderParams = {}) {
    super(id, configId, apiKey, { baseURL }, parsedParams);
  }

  async listModels(): Promise<Model[]> {
    // No generic /models endpoint — return a static fallback list so users
    // have known options. Users can manually enter any model id the vendor
    // supports (UI will allow custom).
    const guesses = ['claude-sonnet-4-5', 'claude-opus-4-0', 'claude-haiku-4-5-20251001'];
    return guesses.map(id => ({
      id,
      name: id,
      contextWindow: 200_000,
      caps: inferCaps(id),
    }));
  }
}

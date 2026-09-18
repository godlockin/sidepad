import { AnthropicBaseProvider, toAnthropicMessages, supportsExtendedThinking, anthropicThinkingParams } from './base/anthropic-base';
import type { Model } from './types';
import { inferCaps } from './caps-heuristics';
import type { ProviderParams } from './overrides';

export class AnthropicProvider extends AnthropicBaseProvider {
  constructor(id: string, configId: string, apiKey: string, parsedParams: ProviderParams = {}) {
    super(id, configId, apiKey, {}, parsedParams);
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: (m as any)?.metadata?.context_window_size ?? 200_000,
        caps: inferCaps(m.id),
      }));
    } catch {
      return [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200_000, caps: inferCaps('claude-sonnet-4-20250514') },
        { id: 'claude-opus-4-0', name: 'Claude Opus 4', contextWindow: 200_000, caps: inferCaps('claude-opus-4-0') },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200_000, caps: inferCaps('claude-haiku-4-5-20251001') },
      ];
    }
  }
}

// Re-export helpers for backwards compat (other files may import)
export { toAnthropicMessages, supportsExtendedThinking, anthropicThinkingParams };

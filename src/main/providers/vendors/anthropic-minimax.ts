import { AnthropicBaseProvider } from '../base/anthropic-base';
import type { Model, ProviderCapabilities } from '../types';
import { inferCaps } from '../caps-heuristics';
import type { ProviderParams } from '../overrides';
import {
  MINIMAX_ANTHROPIC_BASE_URL,
  MINIMAX_ANTHROPIC_BASE_URL_CN,
} from '../../../shared/providers/vendor-defaults';

export { MINIMAX_ANTHROPIC_BASE_URL, MINIMAX_ANTHROPIC_BASE_URL_CN };

const DEFAULT_MODELS = [
  { id: 'MiniMax-M3', contextWindow: 1_000_000 },
  { id: 'MiniMax-M3.1-Flash-Preview', contextWindow: 1_000_000 },
  { id: 'MiniMax-M2.5', contextWindow: 200_000 },
  { id: 'MiniMax-M2', contextWindow: 200_000 },
];

/**
 * MiniMax via Anthropic Messages protocol.
 *
 * Auth uses the Anthropic SDK apiKey (forwarded as x-api-key; MiniMax also
 * accepts Bearer). Point baseURL at the CN endpoint when needed.
 */
export class AnthropicMinimaxProvider extends AnthropicBaseProvider {
  constructor(
    id: string,
    configId: string,
    apiKey: string,
    baseURL: string = MINIMAX_ANTHROPIC_BASE_URL,
    parsedParams: ProviderParams = {},
  ) {
    super(id, configId, apiKey, { baseURL: baseURL || MINIMAX_ANTHROPIC_BASE_URL }, parsedParams);
  }

  async listModels(): Promise<Model[]> {
    return DEFAULT_MODELS.map((m) => ({
      id: m.id,
      name: m.id,
      contextWindow: m.contextWindow,
      caps: this.capabilities(m.id),
    }));
  }

  capabilities(model: string): ProviderCapabilities {
    const base = inferCaps(model);
    const m = model.toLowerCase();
    // M3 family is multimodal + tools + thinking per MiniMax docs.
    const isM3 = m.includes('minimax-m3') || m.includes('m3.1');
    return {
      vision: isM3 || base.vision,
      tools: true,
      reasoning: isM3 || base.reasoning || /m2\.5|m2\.7/i.test(m),
    };
  }
}

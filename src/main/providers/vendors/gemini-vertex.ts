import { GeminiProvider } from '../gemini';
import type { ProviderParams } from '../overrides';
import { GEMINI_VERTEX_BASE_URL_HINT } from '../../../shared/providers/vendor-defaults';

export { GEMINI_VERTEX_BASE_URL_HINT };

/**
 * Gemini on Vertex AI — same protocol as GeminiProvider with a Vertex-oriented
 * baseURL. Requires an explicit baseURL (project/location) to connect.
 *
 * Auth: GoogleGenAI apiKey — for Vertex ADC/OAuth, users typically supply an
 * API key or gateway that injects credentials. Full ADC signing is out of scope.
 */
export class GeminiVertexProvider extends GeminiProvider {
  constructor(
    id: string,
    configId: string,
    apiKey: string,
    baseURL: string,
    parsedParams: ProviderParams = {},
  ) {
    if (!baseURL?.trim()) {
      throw new Error('baseURL required for gemini-vertex (include project + location)');
    }
    super(id, configId, apiKey, baseURL, parsedParams);
  }
}

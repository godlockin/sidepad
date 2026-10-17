/** International MiniMax Anthropic-compatible base URL. */
export const MINIMAX_ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
/** China MiniMax Anthropic-compatible base URL. */
export const MINIMAX_ANTHROPIC_BASE_URL_CN = 'https://api.minimax.cn/anthropic';

/**
 * Vertex AI Gemini publisher base URL hint — replace YOUR_PROJECT / location.
 */
export const GEMINI_VERTEX_BASE_URL_HINT =
  'https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT/locations/us-central1/publishers/google';

/** Claude on Vertex: projectId@region (region may be global / us / eu / us-east5). */
export const ANTHROPIC_VERTEX_ENDPOINT_HINT = 'YOUR_PROJECT@us-east5';

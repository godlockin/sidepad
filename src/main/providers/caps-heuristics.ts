/**
 * Infer ModelCaps from a model ID string using naming heuristics.
 * No network call — best-effort static analysis only.
 */
import type { ModelCaps } from './types.js';

function has(id: string, ...terms: string[]): boolean {
  const lo = id.toLowerCase();
  return terms.some(t => lo.includes(t));
}

export function inferCaps(id: string): ModelCaps {
  const caps: ModelCaps = {};

  // Free tier — OpenRouter :free suffix, NVIDIA NIM free models, known gratis endpoints
  if (id.endsWith(':free') || has(id, 'llama-3', 'llama3', 'mistral-7b', 'gemma', 'phi-3', 'phi3')) {
    caps.free = true;
  }

  // Tool use / function calling
  if (
    has(id, 'gpt-4', 'gpt-3.5', 'claude', 'gemini', 'mistral', 'llama-3', 'llama3',
        'qwen', 'deepseek', 'glm-4', 'moonshot', 'mixtral', 'command-r',
        'yi-', 'phi-3', 'phi3', 'hermes', 'functionary', 'tool')
  ) {
    caps.tools = true;
  }

  // Vision / multimodal
  if (
    has(id, 'vision', 'vl', '-v-', '-v2', 'gpt-4o', 'gpt-4-turbo', 'claude-3',
        'gemini', 'llava', 'qwen-vl', 'intern-vl', 'minicpm-v',
        'pixtral', 'phi-3-vision', 'phi3-vision', 'cogvlm', 'glm-4v')
  ) {
    caps.vision = true;
  }

  // Reasoning / extended CoT
  if (has(id, 'o1', 'o3', 'thinking', 'reason', 'r1', 'r-1', 'qwq', 'deepseek-r')) {
    caps.reasoning = true;
  }

  // Web search built-in
  if (has(id, 'sonar', 'online', 'internet', 'web-search', 'websearch', 'perplexity')) {
    caps.web = true;
  }

  // Fast / small / edge variant
  if (has(id, 'mini', 'flash', 'tiny', 'small', 'nano', 'lite', 'turbo', 'haiku', 'instant', '1b', '3b', '7b')) {
    caps.fast = true;
  }

  return caps;
}

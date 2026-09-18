import type { ChatRequest } from './types';

export interface ModelOverride {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  toolChoice?: string;
  thinkingBudget?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  safetySettings?: unknown;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export interface ProviderParams {
  defaultModel?: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  modelOverrides?: Record<string, ModelOverride>;
}

export function parseProviderParams(json: string | null | undefined): ProviderParams {
  if (!json) return {};
  try {
    return JSON.parse(json) as ProviderParams;
  } catch {
    return {};
  }
}

/**
 * Merge precedence (low → high):
 *   extraHeaders/extraBody (provider-level)
 *   → modelOverrides[req.model]
 *   → ChatRequest runtime fields (temperature, maxTokens)
 */
export function mergeOverrides(
  req: ChatRequest,
  params: ProviderParams,
): { headers: Record<string, string>; body: Record<string, unknown> } {
  const mo = params.modelOverrides?.[req.model] ?? {};
  const headers: Record<string, string> = {
    ...(params.extraHeaders ?? {}),
    ...(mo.extraHeaders ?? {}),
  };
  const body: Record<string, unknown> = {
    ...(params.extraBody ?? {}),
    ...stripUndefined(mo),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  };
  return { headers, body };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

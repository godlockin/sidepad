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
 *   → modelOverrides[req.model] (per-model extras flatten into body)
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
  // Pull per-model extraBody out so it flattens into body at the right
  // precedence level (not as a nested key inside body.extraBody).
  const { extraBody: moExtraBody, ...moRest } = mo;
  const body: Record<string, unknown> = {
    ...(params.extraBody ?? {}),
    ...(moExtraBody ?? {}),
    ...stripUndefined(moRest),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  };
  return { headers, body };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

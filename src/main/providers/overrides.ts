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

/** Headers that must never be set via extraHeaders (auth / hop-by-hop). */
export const RESERVED_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'api_key',
  'anthropic-version',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
]);

/**
 * Body keys that callers must not inject via extraBody / overrides.
 * These are owned by the provider chat() implementation (model, messages,
 * stream, tools, thinking blocks, etc.).
 */
export const PROTECTED_BODY_KEYS = new Set([
  'model',
  'messages',
  'stream',
  'input',
  'system',
  'tools',
  'thinking',
  'contents',
  'candidates',
  'config',
  'systeminstruction',
  'system_instruction',
]);

/** Inclusive clamp for Anthropic / Gemini thinking budgets (tokens). */
export const THINKING_BUDGET_MIN = 128;
export const THINKING_BUDGET_MAX = 200_000;

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
 *
 * Then sanitize: strip reserved headers, protected body keys, and validate
 * thinkingBudget so misconfigured Advanced overrides cannot hijack the request.
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
  return {
    headers: sanitizeHeaders(headers),
    body: sanitizeBody(body),
  };
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== 'string') continue;
    if (RESERVED_HEADER_NAMES.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PROTECTED_BODY_KEYS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  if ('thinkingBudget' in out) {
    const normalized = normalizeThinkingBudget(out.thinkingBudget);
    if (normalized === undefined) delete out.thinkingBudget;
    else out.thinkingBudget = normalized;
  }
  return out;
}

export function normalizeThinkingBudget(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.max(THINKING_BUDGET_MIN, Math.min(THINKING_BUDGET_MAX, Math.floor(raw)));
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

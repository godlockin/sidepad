/** Flat provider type enum registered in factory / router / UI. */
export const PROVIDER_KINDS = [
  'openai',
  'anthropic',
  'ollama',
  'openai-compat',
  'anthropic-messages',
  'gemini',
  'anthropic-minimax',
  'gemini-vertex',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export function needsBaseURL(kind: ProviderKind): boolean {
  return (
    kind === 'openai-compat' ||
    kind === 'ollama' ||
    kind === 'anthropic-messages' ||
    kind === 'gemini' ||
    kind === 'anthropic-minimax' ||
    kind === 'gemini-vertex'
  );
}

export function requiresBaseURL(kind: ProviderKind): boolean {
  return (
    kind === 'openai-compat' ||
    kind === 'anthropic-messages' ||
    kind === 'anthropic-minimax' ||
    kind === 'gemini-vertex'
  );
}

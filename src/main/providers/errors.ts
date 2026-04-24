export type ErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CONTEXT_TOO_LARGE'
  | 'MODEL_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'UNKNOWN';

export interface ProviderErrorOptions {
  retriable?: boolean;
}

const RETRIABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  'RATE_LIMITED',
  'NETWORK_ERROR',
]);

export class ProviderError extends Error {
  public readonly code: ErrorCode;
  public readonly retriable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: ProviderErrorOptions,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retriable = options?.retriable ?? RETRIABLE_CODES.has(code);
  }
}

const CODE_PATTERNS: { patterns: RegExp[]; code: ErrorCode }[] = [
  { patterns: [/(?:401|unauthorized|invalid (?:api|token|key)|authentication)/i], code: 'AUTH_FAILED' },
  { patterns: [/(?:429|rate.limit|too.many.requests|throttl)/i], code: 'RATE_LIMITED' },
  { patterns: [/(?:context.*too.*large|token.*limit.*exceed|prompt.*too.*long|input.*too.*long|413)/i], code: 'CONTEXT_TOO_LARGE' },
  { patterns: [/(?:model.*not.*found|unknown.*model|invalid.*model|model.*invalid)/i], code: 'MODEL_NOT_FOUND' },
  { patterns: [/(?:network|connect|socket.*hang.*up|fetch.*fail|econnrefused|eai_again)/i], code: 'NETWORK_ERROR' },
  { patterns: [/(?:abort)/i], code: 'ABORTED' },
  { patterns: [/(?:not.*configur|no.*api.*key|no.*config)/i], code: 'PROVIDER_NOT_CONFIGURED' },
];

export function normalizeError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  for (const { patterns, code } of CODE_PATTERNS) {
    if (patterns.some((p) => p.test(lower))) {
      return new ProviderError(code, message);
    }
  }

  return new ProviderError('UNKNOWN', message);
}

/** Parsed Bedrock auth from the single secret-store string. */
export interface BedrockCredential {
  /** AWS bearer token (`AWS_BEARER_TOKEN_BEDROCK`). */
  apiKey?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsSessionToken?: string;
}

/**
 * Accepts a bearer token, a JSON object, or two-to-three lines
 * (`accessKeyId`, `secretAccessKey`, optional session token).
 * Empty input means the default AWS credential chain.
 */
export function parseBedrockCredential(raw: string | undefined | null): BedrockCredential {
  const text = (raw ?? '').trim();
  if (!text) return {};

  if (text.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { apiKey: text };
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      return compact({
        apiKey: str(o.apiKey) ?? str(o.bearer) ?? str(o.token),
        awsAccessKey: str(o.awsAccessKey) ?? str(o.accessKeyId),
        awsSecretKey: str(o.awsSecretKey) ?? str(o.secretAccessKey),
        awsSessionToken: str(o.awsSessionToken) ?? str(o.sessionToken),
      });
    }
  }

  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return compact({
      awsAccessKey: lines[0],
      awsSecretKey: lines[1],
      awsSessionToken: lines[2],
    });
  }

  return { apiKey: text };
}

function compact(cred: BedrockCredential): BedrockCredential {
  const out: BedrockCredential = {};
  if (cred.apiKey) out.apiKey = cred.apiKey;
  if (cred.awsAccessKey) out.awsAccessKey = cred.awsAccessKey;
  if (cred.awsSecretKey) out.awsSecretKey = cred.awsSecretKey;
  if (cred.awsSessionToken) out.awsSessionToken = cred.awsSessionToken;
  return out;
}

const REGION_RE = /^[a-z]{2}(-gov)?-[a-z0-9-]+-\d+$/;

/** Region code, or a full Bedrock runtime URL (region parsed from the host when present). */
export function parseBedrockEndpoint(baseURL?: string | null): { awsRegion: string; baseURL?: string } {
  const v = (baseURL ?? '').trim();
  if (!v) return { awsRegion: 'us-east-1' };
  if (/^https?:\/\//i.test(v)) {
    const host = v.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/i);
    return {
      awsRegion: host?.[1] && REGION_RE.test(host[1]) ? host[1] : 'us-east-1',
      baseURL: v.replace(/\/$/, ''),
    };
  }
  if (!REGION_RE.test(v)) {
    throw new Error(`invalid Bedrock region "${v}" (expected e.g. us-east-1)`);
  }
  return { awsRegion: v };
}

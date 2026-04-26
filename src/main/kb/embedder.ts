import type Database from 'better-sqlite3';
import { readAppSetting } from '../store/app-settings-store.js';

export interface EmbedderConfig {
  provider: 'ollama' | 'openai';
  model: string;
  baseUrl: string;
  apiKey?: string;
}

const DEFAULTS: EmbedderConfig = {
  provider: 'ollama',
  model: 'nomic-embed-text',
  baseUrl: 'http://localhost:11434',
};

export function getEmbedderConfig(db: Database.Database): EmbedderConfig {
  const provider = (readAppSetting(db, 'kb_embedder_provider') as
    | 'ollama'
    | 'openai'
    | undefined) ?? DEFAULTS.provider;
  const model = readAppSetting(db, 'kb_embedder_model') ?? DEFAULTS.model;
  const baseUrl =
    readAppSetting(db, 'kb_embedder_base_url') ??
    (provider === 'openai' ? 'https://api.openai.com' : DEFAULTS.baseUrl);
  const apiKey = readAppSetting(db, 'kb_embedder_api_key');
  return { provider, model, baseUrl, apiKey };
}

export function setEmbedderConfig(
  db: Database.Database,
  cfg: { provider: 'ollama' | 'openai'; model: string; baseUrl?: string; apiKey?: string },
): void {
  const stmt = db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  );
  const now = Date.now();
  stmt.run('kb_embedder_provider', cfg.provider, now);
  stmt.run('kb_embedder_model', cfg.model, now);
  if (cfg.baseUrl !== undefined) stmt.run('kb_embedder_base_url', cfg.baseUrl, now);
  if (cfg.apiKey !== undefined) stmt.run('kb_embedder_api_key', cfg.apiKey, now);
}

export function serializeEmbedding(f32: Float32Array): Buffer {
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function deserializeEmbedding(buf: Buffer): Float32Array {
  // Copy into an aligned ArrayBuffer (Buffer slabs may not be 4-aligned).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}

async function embedOllama(
  cfg: EmbedderConfig,
  texts: string[],
): Promise<Float32Array[]> {
  // Ollama's /api/embeddings is one prompt at a time. Run with concurrency 4.
  const out: Float32Array[] = new Array(texts.length);
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, prompt: texts[idx] }),
      });
      if (!res.ok) {
        throw new Error(`ollama embeddings failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding: number[] };
      out[idx] = Float32Array.from(json.embedding);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}

async function embedOpenAI(
  cfg: EmbedderConfig,
  texts: string[],
): Promise<Float32Array[]> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`openai embeddings failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => Float32Array.from(d.embedding));
}

export async function embed(
  db: Database.Database,
  texts: string[],
): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const cfg = getEmbedderConfig(db);
  const BATCH = 64;
  const out: Float32Array[] = [];
  for (let off = 0; off < texts.length; off += BATCH) {
    const slice = texts.slice(off, off + BATCH);
    const vecs =
      cfg.provider === 'openai'
        ? await embedOpenAI(cfg, slice)
        : await embedOllama(cfg, slice);
    out.push(...vecs);
  }
  return out;
}

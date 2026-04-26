export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

export interface Chunk {
  text: string;
  tokenEstimate: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hardWrap(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length > maxChars && cur.length > 0) {
      out.push(cur);
      cur = w.trimStart();
    } else {
      cur += w;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function chunkText(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 500;
  const overlapTokens = opts.overlapTokens ?? 80;
  const overlapChars = overlapTokens * 4;

  const paragraphs = markdown
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // First, hard-wrap any paragraph too large for one chunk.
  const units: string[] = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= maxTokens) units.push(p);
    else units.push(...hardWrap(p, maxTokens));
  }

  const chunks: Chunk[] = [];
  let buf = '';
  let bufTokens = 0;
  for (const u of units) {
    const uTok = estimateTokens(u);
    if (buf && bufTokens + uTok > maxTokens) {
      chunks.push({ text: buf, tokenEstimate: bufTokens });
      // Start next chunk with overlap tail of the previous.
      const tail = buf.slice(Math.max(0, buf.length - overlapChars));
      buf = tail ? tail + '\n\n' + u : u;
      bufTokens = estimateTokens(buf);
    } else {
      buf = buf ? buf + '\n\n' + u : u;
      bufTokens += uTok + (buf === u ? 0 : 0);
      bufTokens = estimateTokens(buf);
    }
  }
  if (buf.length) chunks.push({ text: buf, tokenEstimate: bufTokens });
  return chunks;
}

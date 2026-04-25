import { estimateTokens, type ParseResult } from './index.js';
import { parseHtml } from './html.js';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const UA = 'Mozilla/5.0 (compatible; sidepad/1.0; +https://github.com/godlockin/sidepad)';

export async function parseUrl(url: string): Promise<ParseResult & { title?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return { markdown: `[fetch failed: HTTP ${res.status}]`, tokenEstimate: 0 };
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return { markdown: '[fetch failed: response too large (>5MB)]', tokenEstimate: 0 };
    }
    html = Buffer.from(ab).toString('utf-8');
  } finally {
    clearTimeout(timer);
  }

  // Try readability + jsdom for main-content extraction; fall back to plain HTML→MD.
  try {
    const [{ JSDOM }, { Readability }] = await Promise.all([
      import('jsdom') as Promise<any>,
      import('@mozilla/readability') as Promise<any>,
    ]);
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.content) {
      const out = await parseHtml(article.content);
      const title = article.title ? `# ${article.title}\n\n` : '';
      const md = title + out.markdown;
      return { markdown: md, tokenEstimate: estimateTokens(md), title: article.title };
    }
  } catch {
    // fall through to raw turndown
  }
  return await parseHtml(html);
}

import { estimateTokens, type ParseResult } from './index.js';

export async function parseHtml(html: string): Promise<ParseResult> {
  // Strip script & style first
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const turndownMod = await import('turndown');
  const TurndownService = (turndownMod as any).default ?? turndownMod;
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const md = td.turndown(cleaned);
  return { markdown: md, tokenEstimate: estimateTokens(md) };
}

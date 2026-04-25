import { estimateTokens, type ParseResult } from './index.js';

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  // pdf-parse is CJS; dynamic import for ESM compatibility
  const mod = await import('pdf-parse');
  const pdfParse = (mod as any).default ?? mod;
  const data = await pdfParse(buffer);
  const text = (data.text ?? '').trim();
  const numPages = data.numpages ?? 1;

  // Heuristic: if average chars-per-page is < 40, likely scanned
  const avgPerPage = numPages > 0 ? text.length / numPages : text.length;
  if (avgPerPage < 40) {
    return {
      markdown: '[scanned PDF — OCR required]',
      tokenEstimate: 0,
    };
  }

  return {
    markdown: text,
    tokenEstimate: estimateTokens(text),
  };
}

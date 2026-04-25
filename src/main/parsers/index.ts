import { parsePdf } from './pdf.js';
import { parseDocx, parseXlsx, parsePptx } from './office.js';
import { parsePlaintext } from './plaintext.js';
import { parseHtml } from './html.js';
import { parseImage } from './image.js';

export interface ParseResult {
  markdown: string;
  tokenEstimate: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

export async function dispatchParse(
  buffer: Buffer,
  filename: string,
  mime?: string,
): Promise<ParseResult> {
  const ext = extOf(filename);
  const m = (mime || '').toLowerCase();

  try {
    if (ext === 'pdf' || m === 'application/pdf') {
      return await parsePdf(buffer);
    }
    if (ext === 'docx' || m.includes('wordprocessingml')) {
      return await parseDocx(buffer);
    }
    if (ext === 'xlsx' || ext === 'xls' || m.includes('spreadsheetml')) {
      return await parseXlsx(buffer);
    }
    if (ext === 'pptx' || m.includes('presentationml')) {
      return await parsePptx(buffer);
    }
    if (ext === 'html' || ext === 'htm' || m.includes('text/html')) {
      return await parseHtml(buffer.toString('utf-8'));
    }
    if (
      ext === 'png' ||
      ext === 'jpg' ||
      ext === 'jpeg' ||
      ext === 'gif' ||
      ext === 'webp' ||
      ext === 'bmp' ||
      m.startsWith('image/')
    ) {
      return await parseImage(buffer, filename, mime);
    }
    // text-ish fallback
    return await parsePlaintext(buffer, filename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      markdown: `[parse failed: ${msg}]`,
      tokenEstimate: 0,
    };
  }
}

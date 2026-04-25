import type { ParseResult } from './index.js';

// STUB: replaced by P1-N (vision/OCR pipeline).
export async function parseImage(
  _buffer: Buffer,
  _filename: string,
  _mime?: string,
): Promise<ParseResult> {
  return {
    markdown: '[image — vision/OCR pipeline pending]',
    tokenEstimate: 0,
  };
}

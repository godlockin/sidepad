import type { ParseResult } from './index.js';
import { ocrImage, type OcrProgress } from '../ocr/tesseract.js';

export interface ImageParseOptions {
  onProgress?: (p: OcrProgress) => void;
}

/**
 * Image parser — OCR fallback path.
 *
 * Vision-capable model routing happens at *send time* (see
 * `orchestrator/vision-router.ts`) because parse time does not yet know
 * which provider/model the user will route the message to. Here we always
 * compute an OCR'd text fallback so non-vision providers still get the
 * extracted text inline.
 */
export async function parseImage(
  buffer: Buffer,
  _filename: string,
  _mime?: string,
  opts: ImageParseOptions = {},
): Promise<ParseResult> {
  return ocrImage(buffer, { onProgress: opts.onProgress });
}

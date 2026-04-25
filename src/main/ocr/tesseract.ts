import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

/**
 * OCR an image buffer to text using tesseract.js.
 *
 * - tesseract.js is dynamically `import()`-ed on first call, so the ~10MB of
 *   wasm/worker code is not loaded unless OCR is actually needed.
 * - Language model files (`eng.traineddata`, `chi_sim.traineddata`, …) are
 *   downloaded by tesseract.js on first run into `userData/tessdata/`. After
 *   that they are cached on disk and reused.
 *
 * Errors are *swallowed* (logged + returned as a placeholder string) so a
 * failed OCR does not break the parser pipeline / upload flow.
 */
export async function ocrImage(
  buffer: Buffer,
  langs: string[] = ['eng', 'chi_sim'],
): Promise<{ markdown: string; tokenEstimate: number }> {
  try {
    const dir = ocrDataDir();
    fs.mkdirSync(dir, { recursive: true });

    // Lazy import so tesseract.js (and its wasm) is not loaded into the main
    // process until an OCR is actually requested.
    const tesseract: any = await import('tesseract.js');
    const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
    if (typeof createWorker !== 'function') {
      throw new Error('tesseract.js: createWorker not available');
    }

    const worker = await createWorker(langs, 1, {
      langPath: dir,
      cachePath: dir,
      gzip: true,
    });
    try {
      const { data } = await worker.recognize(buffer);
      const text = (data?.text ?? '').trim();
      return {
        markdown: text,
        tokenEstimate: Math.ceil(text.length / 4),
      };
    } finally {
      try {
        await worker.terminate();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[ocr] tesseract failed:', msg);
    return { markdown: `[OCR failed: ${msg}]`, tokenEstimate: 0 };
  }
}

function ocrDataDir(): string {
  try {
    return path.join(app.getPath('userData'), 'tessdata');
  } catch {
    // electron app may not be ready in tests / CLI contexts
    return path.join(process.cwd(), '.sidepad-data', 'tessdata');
  }
}

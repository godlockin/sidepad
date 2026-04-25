import { estimateTokens, type ParseResult } from './index.js';

export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const mammoth = await import('mammoth');
  const fn = (mammoth as any).convertToMarkdown ?? (mammoth as any).default?.convertToMarkdown;
  const result = await fn({ buffer });
  const md = (result?.value ?? '').trim();
  return { markdown: md, tokenEstimate: estimateTokens(md) };
}

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const xlsxMod = await import('xlsx');
  const XLSX = (xlsxMod as any).default ?? xlsxMod;
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out: string[] = [];
  for (const name of wb.SheetNames as string[]) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
    out.push(`## ${name}\n`);
    if (rows.length === 0) {
      out.push('_(empty)_\n');
      continue;
    }
    const header = rows[0].map((c) => String(c ?? ''));
    out.push('| ' + header.join(' | ') + ' |');
    out.push('| ' + header.map(() => '---').join(' | ') + ' |');
    const cap = Math.min(rows.length, 201);
    for (let i = 1; i < cap; i++) {
      const r = rows[i] ?? [];
      const padded = header.map((_, j) => String(r[j] ?? '').replace(/\|/g, '\\|'));
      out.push('| ' + padded.join(' | ') + ' |');
    }
    if (rows.length > 201) {
      out.push(`\n_… ${rows.length - 201} more rows truncated_\n`);
    }
    out.push('');
  }
  const md = out.join('\n');
  return { markdown: md, tokenEstimate: estimateTokens(md) };
}

export async function parsePptx(buffer: Buffer): Promise<ParseResult> {
  const jszipMod = await import('jszip');
  const JSZip = (jszipMod as any).default ?? jszipMod;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const ai = parseInt(a.match(/slide(\d+)/)![1], 10);
      const bi = parseInt(b.match(/slide(\d+)/)![1], 10);
      return ai - bi;
    });

  const out: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    // crude text extraction: grab <a:t>...</a:t>
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    const text = matches
      .map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
      .filter((t: string) => t.trim())
      .join('\n');
    out.push(`## Slide ${i + 1}\n\n${text}\n`);
  }
  const md = out.join('\n');
  return { markdown: md, tokenEstimate: estimateTokens(md) };
}

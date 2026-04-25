import { estimateTokens, type ParseResult } from './index.js';

const CODE_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  xml: 'xml',
};

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function csvToMarkdown(text: string, filename: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return '_(empty CSV)_';
  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const rows = lines.map(parseRow);
  const header = rows[0];
  const out: string[] = [];
  out.push('| ' + header.map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |');
  out.push('| ' + header.map(() => '---').join(' | ') + ' |');
  const cap = Math.min(rows.length, 201);
  for (let i = 1; i < cap; i++) {
    const r = rows[i];
    const padded = header.map((_, j) => String(r[j] ?? '').replace(/\|/g, '\\|'));
    out.push('| ' + padded.join(' | ') + ' |');
  }
  if (rows.length > 201) {
    out.push(`\n_… ${rows.length - 201} more rows truncated. See full file: ${filename}_`);
  }
  return out.join('\n');
}

export async function parsePlaintext(buffer: Buffer, filename: string): Promise<ParseResult> {
  const text = buffer.toString('utf-8');
  const ext = extOf(filename);

  let markdown: string;
  if (ext === 'csv') {
    markdown = csvToMarkdown(text, filename);
  } else if (ext === 'md' || ext === 'markdown' || ext === 'txt' || ext === '') {
    markdown = text;
  } else if (ext === 'json') {
    markdown = '```json\n' + text + '\n```';
  } else {
    const lang = CODE_LANG[ext] ?? ext;
    markdown = '```' + lang + '\n' + text + '\n```';
  }

  return { markdown, tokenEstimate: estimateTokens(markdown) };
}

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { dispatchParse } from '../parsers/index.js';
import { chunkText } from './chunker.js';
import {
  embed,
  serializeEmbedding,
  deserializeEmbedding,
  getEmbedderConfig,
} from './embedder.js';

export type IndexPhase = 'parse' | 'chunk' | 'embed';
export interface IndexProgress {
  phase: IndexPhase;
  current: number;
  total: number;
}

export interface KbDocumentRow {
  id: string;
  source_type: string;
  source_path: string;
  filename: string | null;
  mime: string | null;
  size_bytes: number | null;
  tags: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  error: string | null;
  chunk_count: number;
  token_count: number;
  created_at: number;
  updated_at: number;
}

const SUPPORTED_EXTS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.html',
  '.htm',
]);

// Per-document progress pub/sub.
type ProgressListener = (p: IndexProgress) => void;
const progressListeners = new Map<string, Set<ProgressListener>>();

function publishProgress(documentId: string, p: IndexProgress): void {
  const set = progressListeners.get(documentId);
  if (!set) return;
  for (const l of set) {
    try {
      l(p);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeProgress(documentId: string, fn: ProgressListener): () => void {
  if (!progressListeners.has(documentId)) {
    progressListeners.set(documentId, new Set());
  }
  progressListeners.get(documentId)!.add(fn);
  return () => {
    progressListeners.get(documentId)?.delete(fn);
  };
}

function mimeFromExt(ext: string): string | undefined {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.md':
      return 'text/markdown';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    default:
      return undefined;
  }
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) out.push(full);
      }
    }
  }
  return out;
}

export interface IndexOptions {
  sourceType: 'file' | 'folder' | 'attachment' | 'url';
  sourcePath: string;
  tags?: string[];
  onProgress?: (p: IndexProgress) => void;
}

function insertDocRow(
  db: Database.Database,
  row: Omit<KbDocumentRow, 'created_at' | 'updated_at'> & {
    created_at?: number;
    updated_at?: number;
  },
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO kb_documents
     (id, source_type, source_path, filename, mime, size_bytes, tags, status, error,
      chunk_count, token_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.source_type,
    row.source_path,
    row.filename,
    row.mime,
    row.size_bytes,
    row.tags,
    row.status,
    row.error,
    row.chunk_count,
    row.token_count,
    row.created_at ?? now,
    row.updated_at ?? now,
  );
}

function updateDoc(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<KbDocumentRow, 'status' | 'error' | 'chunk_count' | 'token_count'>>,
): void {
  const sets: string[] = [];
  const args: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  sets.push('updated_at = ?');
  args.push(Date.now());
  args.push(id);
  db.prepare(`UPDATE kb_documents SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

async function indexSingleFile(
  db: Database.Database,
  documentId: string,
  filePath: string,
  tags: string[] | undefined,
  onProgress?: (p: IndexProgress) => void,
): Promise<void> {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeFromExt(ext);
  const buffer = fs.readFileSync(filePath);

  const emit = (p: IndexProgress) => {
    publishProgress(documentId, p);
    if (onProgress) onProgress(p);
  };

  emit({ phase: 'parse', current: 0, total: 1 });
  const parsed = await dispatchParse(buffer, filename, mime);
  emit({ phase: 'parse', current: 1, total: 1 });

  updateDoc(db, documentId, { status: 'indexing' });

  const chunks = chunkText(parsed.markdown);
  emit({ phase: 'chunk', current: chunks.length, total: chunks.length });

  // Embed in batches; report per-batch progress.
  const cfg = getEmbedderConfig(db);
  const BATCH = 64;
  let done = 0;
  const allEmbeddings: Float32Array[] = [];
  for (let off = 0; off < chunks.length; off += BATCH) {
    const slice = chunks.slice(off, off + BATCH).map((c) => c.text);
    const vecs = await embed(db, slice);
    allEmbeddings.push(...vecs);
    done += slice.length;
    emit({ phase: 'embed', current: done, total: chunks.length });
  }

  const insertChunk = db.prepare(
    `INSERT INTO kb_chunks (id, document_id, chunk_index, text, token_estimate, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      insertChunk.run(
        randomUUID(),
        documentId,
        i,
        chunks[i].text,
        chunks[i].tokenEstimate,
        allEmbeddings[i] ? serializeEmbedding(allEmbeddings[i]) : null,
        cfg.model,
        now,
      );
    }
  });
  tx();

  const totalTokens = chunks.reduce((s, c) => s + c.tokenEstimate, 0);
  updateDoc(db, documentId, {
    status: 'ready',
    chunk_count: chunks.length,
    token_count: totalTokens,
    error: null,
  });
  // tags is set at insert; nothing to update here.
  void tags;
  void filename;
}

export async function indexDocument(
  db: Database.Database,
  opts: IndexOptions,
): Promise<{ id: string }> {
  const { sourceType, sourcePath, tags, onProgress } = opts;
  const id = randomUUID();
  const tagsJson = tags ? JSON.stringify(tags) : null;

  // For folders, create one parent row (status 'ready' once children done) and
  // a child row per file. Simplest semantics: do not create a parent row;
  // create one document per file. Caller gets the first id but additional
  // documents will appear in list().
  if (sourceType === 'folder') {
    const stat = fs.statSync(sourcePath);
    if (!stat.isDirectory()) {
      throw new Error(`not a directory: ${sourcePath}`);
    }
    const files = walkDir(sourcePath);
    if (!files.length) {
      // Insert a stub error row so user sees feedback.
      insertDocRow(db, {
        id,
        source_type: 'folder',
        source_path: sourcePath,
        filename: path.basename(sourcePath),
        mime: null,
        size_bytes: null,
        tags: tagsJson,
        status: 'error',
        error: 'no supported files found',
        chunk_count: 0,
        token_count: 0,
      });
      return { id };
    }
    // Kick off each file as its own doc.
    let firstId: string | null = null;
    for (const f of files) {
      const childId = randomUUID();
      if (!firstId) firstId = childId;
      const stCh = fs.statSync(f);
      insertDocRow(db, {
        id: childId,
        source_type: 'file',
        source_path: f,
        filename: path.basename(f),
        mime: mimeFromExt(path.extname(f).toLowerCase()) ?? null,
        size_bytes: stCh.size,
        tags: tagsJson,
        status: 'pending',
        error: null,
        chunk_count: 0,
        token_count: 0,
      });
      void runIndexAsync(db, childId, f, tags);
    }
    return { id: firstId ?? id };
  }

  // Single file.
  const stat = fs.statSync(sourcePath);
  insertDocRow(db, {
    id,
    source_type: sourceType,
    source_path: sourcePath,
    filename: path.basename(sourcePath),
    mime: mimeFromExt(path.extname(sourcePath).toLowerCase()) ?? null,
    size_bytes: stat.size,
    tags: tagsJson,
    status: 'pending',
    error: null,
    chunk_count: 0,
    token_count: 0,
  });
  void runIndexAsync(db, id, sourcePath, tags, onProgress);
  return { id };
}

async function runIndexAsync(
  db: Database.Database,
  id: string,
  filePath: string,
  tags?: string[],
  onProgress?: (p: IndexProgress) => void,
): Promise<void> {
  try {
    await indexSingleFile(db, id, filePath, tags, onProgress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateDoc(db, id, { status: 'error', error: msg });
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SearchHit {
  documentId: string;
  chunkId: string;
  text: string;
  score: number;
  filename: string | null;
}

// TODO: replace with sqlite-vec or HNSW once libraries cleared for bundling.
// For now, naive in-memory cosine over all chunks. OK up to ~10k chunks.
export async function searchKnowledge(
  db: Database.Database,
  query: string,
  k = 5,
  opts: { tags?: string[] } = {},
): Promise<SearchHit[]> {
  const [qVec] = await embed(db, [query]);
  if (!qVec) return [];

  let sql = `SELECT c.id AS chunk_id, c.document_id, c.text, c.embedding,
                    d.filename, d.tags
             FROM kb_chunks c
             JOIN kb_documents d ON d.id = c.document_id
             WHERE d.status = 'ready' AND c.embedding IS NOT NULL`;
  const args: any[] = [];
  const rows = db.prepare(sql).all(...args) as Array<{
    chunk_id: string;
    document_id: string;
    text: string;
    embedding: Buffer;
    filename: string | null;
    tags: string | null;
  }>;

  const wantTags = opts.tags && opts.tags.length ? opts.tags : null;

  const scored: SearchHit[] = [];
  for (const r of rows) {
    if (wantTags) {
      let docTags: string[] = [];
      try {
        docTags = r.tags ? (JSON.parse(r.tags) as string[]) : [];
      } catch {
        /* ignore */
      }
      if (!wantTags.some((t) => docTags.includes(t))) continue;
    }
    const v = deserializeEmbedding(r.embedding);
    const s = cosine(qVec, v);
    scored.push({
      documentId: r.document_id,
      chunkId: r.chunk_id,
      text: r.text,
      score: s,
      filename: r.filename,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function listKnowledge(db: Database.Database): KbDocumentRow[] {
  return db
    .prepare('SELECT * FROM kb_documents ORDER BY updated_at DESC')
    .all() as KbDocumentRow[];
}

export function deleteKnowledge(db: Database.Database, documentId: string): void {
  // ON DELETE CASCADE handles kb_chunks.
  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(documentId);
}

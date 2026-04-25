import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { Observer, TeardownLogic } from '@trpc/server/observable';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import { dispatchParse } from '../../parsers/index.js';
import { parseUrl } from '../../parsers/web.js';

const t = initTRPC.create({ isServer: true });

export interface AttachmentRow {
  id: string;
  session_id: string;
  message_id: string | null;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  storage_path: string;
  parsed_markdown: string | null;
  parse_status: 'pending' | 'parsing' | 'ready' | 'error';
  parse_error: string | null;
  token_estimate: number | null;
  created_at: number;
}

function getDb(): Database.Database {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return db;
}

function attachmentsBaseDir(): string {
  // Allow override for testing/non-electron contexts.
  const override = (globalThis as any).sidepad?.userDataDir as string | undefined;
  const base = override ?? (app?.getPath ? app.getPath('userData') : path.join(process.cwd(), '.sidepad-data'));
  return path.join(base, 'attachments');
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

// Simple in-process pub/sub for parse-status updates.
type Listener = (row: AttachmentRow) => void;
const listeners = new Map<string, Set<Listener>>(); // sessionId -> listeners

function emit(sessionId: string, row: AttachmentRow): void {
  const set = listeners.get(sessionId);
  if (!set) return;
  for (const l of set) {
    try {
      l(row);
    } catch {
      /* ignore */
    }
  }
}

function rowById(id: string): AttachmentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(id) as AttachmentRow | undefined;
}

function setStatus(
  id: string,
  status: AttachmentRow['parse_status'],
  fields: Partial<Pick<AttachmentRow, 'parsed_markdown' | 'parse_error' | 'token_estimate'>> = {},
): void {
  const db = getDb();
  db.prepare(
    `UPDATE attachments
     SET parse_status = ?,
         parsed_markdown = COALESCE(?, parsed_markdown),
         parse_error = ?,
         token_estimate = COALESCE(?, token_estimate)
     WHERE id = ?`,
  ).run(
    status,
    fields.parsed_markdown ?? null,
    fields.parse_error ?? null,
    fields.token_estimate ?? null,
    id,
  );
  const row = rowById(id);
  if (row) emit(row.session_id, row);
}

async function runParseAsync(id: string, buffer: Buffer, filename: string, mime?: string): Promise<void> {
  setStatus(id, 'parsing');
  try {
    const result = await dispatchParse(buffer, filename, mime);
    setStatus(id, 'ready', {
      parsed_markdown: result.markdown,
      token_estimate: result.tokenEstimate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(id, 'error', { parse_error: msg });
  }
}

export const attachmentRouter = t.router({
  upload: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        filename: z.string(),
        mime: z.string().optional(),
        dataBase64: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const id = randomUUID();
      const buffer = Buffer.from(input.dataBase64, 'base64');
      const dir = path.join(attachmentsBaseDir(), input.sessionId);
      fs.mkdirSync(dir, { recursive: true });
      const storagePath = path.join(dir, `${id}-${safeName(input.filename)}`);
      fs.writeFileSync(storagePath, buffer);

      const db = getDb();
      db.prepare(
        `INSERT INTO attachments
         (id, session_id, message_id, filename, mime, size_bytes, storage_path,
          parsed_markdown, parse_status, parse_error, token_estimate, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, ?)`,
      ).run(
        id,
        input.sessionId,
        input.filename,
        input.mime ?? null,
        buffer.byteLength,
        storagePath,
        Date.now(),
      );

      // Kick off parse asynchronously (don't await)
      void runParseAsync(id, buffer, input.filename, input.mime);

      return { id, parsing: true as const };
    }),

  fetchUrl: t.procedure
    .input(z.object({ sessionId: z.string(), url: z.string().url() }))
    .mutation(async ({ input }) => {
      const id = randomUUID();
      const db = getDb();
      db.prepare(
        `INSERT INTO attachments
         (id, session_id, message_id, filename, mime, size_bytes, storage_path,
          parsed_markdown, parse_status, parse_error, token_estimate, created_at)
         VALUES (?, ?, NULL, ?, 'text/html', NULL, '', NULL, 'parsing', NULL, NULL, ?)`,
      ).run(id, input.sessionId, input.url, Date.now());

      try {
        const result = await parseUrl(input.url);
        const filename = (result as any).title ?? input.url;
        db.prepare(
          `UPDATE attachments
           SET filename = ?, parsed_markdown = ?, token_estimate = ?, parse_status = 'ready'
           WHERE id = ?`,
        ).run(filename, result.markdown, result.tokenEstimate, id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        db.prepare(
          `UPDATE attachments SET parse_status = 'error', parse_error = ? WHERE id = ?`,
        ).run(msg, id);
      }
      const row = rowById(id);
      if (row) emit(row.session_id, row);
      return { id };
    }),

  get: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return rowById(input.id) ?? null;
    }),

  list: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return getDb()
        .prepare('SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at ASC')
        .all(input.sessionId) as AttachmentRow[];
    }),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const row = rowById(input.id);
      if (!row) return { ok: false };
      try {
        if (row.storage_path && fs.existsSync(row.storage_path)) fs.unlinkSync(row.storage_path);
      } catch {
        /* ignore */
      }
      getDb().prepare('DELETE FROM attachments WHERE id = ?').run(input.id);
      return { ok: true };
    }),

  attachToMessage: t.procedure
    .input(z.object({ ids: z.array(z.string()), messageId: z.string() }))
    .mutation(({ input }) => {
      const stmt = getDb().prepare('UPDATE attachments SET message_id = ? WHERE id = ?');
      const tx = getDb().transaction(() => {
        for (const id of input.ids) stmt.run(input.messageId, id);
      });
      tx();
      return { ok: true };
    }),

  onParsed: t.procedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<AttachmentRow, Error>(
        (observer: Observer<AttachmentRow, Error>): TeardownLogic => {
          const fn: Listener = (row) => observer.next(row);
          if (!listeners.has(input.sessionId)) listeners.set(input.sessionId, new Set());
          listeners.get(input.sessionId)!.add(fn);
          return () => {
            listeners.get(input.sessionId)?.delete(fn);
          };
        },
      );
    }),
});

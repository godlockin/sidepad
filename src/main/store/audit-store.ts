import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface AuditEvent {
  id: string;
  sessionId: string | null;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: number;
}

export function appendAuditEvent(
  db: Database.Database,
  input: {
    sessionId?: string | null;
    kind: string;
    summary: string;
    detail?: Record<string, unknown> | null;
  },
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO audit_events (id, session_id, kind, summary, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.sessionId ?? null,
    input.kind,
    input.summary.slice(0, 500),
    input.detail ? JSON.stringify(input.detail).slice(0, 8000) : null,
    now,
  );
}

export function listAuditEvents(
  db: Database.Database,
  opts: { sessionId?: string | null; limit?: number } = {},
): AuditEvent[] {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 40));
  const rows = (
    opts.sessionId
      ? db
          .prepare(
            `SELECT id, session_id, kind, summary, detail_json, created_at
             FROM audit_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(opts.sessionId, limit)
      : db
          .prepare(
            `SELECT id, session_id, kind, summary, detail_json, created_at
             FROM audit_events ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit)
  ) as Array<{
    id: string;
    session_id: string | null;
    kind: string;
    summary: string;
    detail_json: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind,
    summary: r.summary,
    detail: r.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : null,
    createdAt: r.created_at,
  }));
}

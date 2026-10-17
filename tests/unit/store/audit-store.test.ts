import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { appendAuditEvent, listAuditEvents } from '@main/store/audit-store';

describe('audit-store', () => {
  it('appends and lists events', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    appendAuditEvent(db, {
      sessionId: 's1',
      kind: 'tool.call',
      summary: 'pty_exec @ __pty__',
      detail: { command: 'ls' },
    });
    const rows = listAuditEvents(db, { sessionId: 's1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('tool.call');
    expect(rows[0]!.detail).toEqual({ command: 'ls' });
  });
});

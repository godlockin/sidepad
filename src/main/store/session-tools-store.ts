import type Database from 'better-sqlite3';

export type SessionToolKind = 'mcp_tool' | 'skill';

export interface SessionToolRecord {
  sessionId: string;
  kind: SessionToolKind;
  refId: string;
  createdAt: number;
}

interface Row {
  session_id: string;
  kind: SessionToolKind;
  ref_id: string;
  created_at: number;
}

function rowToRecord(r: Row): SessionToolRecord {
  return {
    sessionId: r.session_id,
    kind: r.kind,
    refId: r.ref_id,
    createdAt: r.created_at,
  };
}

export interface SessionToolsStore {
  attach(sessionId: string, kind: SessionToolKind, refId: string): void;
  detach(sessionId: string, kind: SessionToolKind, refId: string): void;
  list(sessionId: string, kind?: SessionToolKind): SessionToolRecord[];
}

export function createSessionToolsStore(db: Database.Database): SessionToolsStore {
  return {
    attach(sessionId, kind, refId) {
      db.prepare(
        'INSERT OR IGNORE INTO session_tools (session_id, kind, ref_id, created_at) VALUES (?,?,?,?)',
      ).run(sessionId, kind, refId, Date.now());
    },
    detach(sessionId, kind, refId) {
      db.prepare(
        'DELETE FROM session_tools WHERE session_id=? AND kind=? AND ref_id=?',
      ).run(sessionId, kind, refId);
    },
    list(sessionId, kind) {
      const rows = (kind
        ? db
            .prepare(
              'SELECT * FROM session_tools WHERE session_id=? AND kind=? ORDER BY created_at ASC',
            )
            .all(sessionId, kind)
        : db
            .prepare(
              'SELECT * FROM session_tools WHERE session_id=? ORDER BY created_at ASC',
            )
            .all(sessionId)) as Row[];
      return rows.map(rowToRecord);
    },
  };
}

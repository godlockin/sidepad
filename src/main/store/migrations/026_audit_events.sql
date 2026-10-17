CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  kind        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  detail_json TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id, created_at DESC);

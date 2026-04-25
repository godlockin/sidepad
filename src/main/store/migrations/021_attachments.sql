CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  parsed_markdown TEXT,
  parse_status TEXT DEFAULT 'pending',
  parse_error TEXT,
  token_estimate INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_session ON attachments(session_id);
CREATE INDEX idx_attachments_message ON attachments(message_id);

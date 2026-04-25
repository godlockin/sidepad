CREATE TABLE IF NOT EXISTS session_tools (
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK(kind IN ('mcp_tool','skill')),
  ref_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_session_tools_session ON session_tools(session_id);

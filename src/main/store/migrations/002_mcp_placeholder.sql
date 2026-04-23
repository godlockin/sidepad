CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio','http','sse')),
  config_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE mcp_tool_usage (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  server_id TEXT,
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);

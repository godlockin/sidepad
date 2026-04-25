CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_message ON mcp_tool_usage(message_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_usage_server  ON mcp_tool_usage(server_id);
CREATE INDEX IF NOT EXISTS idx_skills_enabled         ON skills(enabled);

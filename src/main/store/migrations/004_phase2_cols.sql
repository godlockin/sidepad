-- Phase 2: Add columns for SessionStore enhancements

-- sessions: default_agent_id for 0-@ routing, participants JSON for multi-agent tracking
ALTER TABLE sessions ADD COLUMN default_agent_id TEXT;
ALTER TABLE sessions ADD COLUMN participants TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

-- messages: finished_at for timing, idx_messages_parent for Edit-Fork queries
ALTER TABLE messages ADD COLUMN finished_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);

-- sidepad schema (Phase 2, reference copy)
-- Single source of truth: migrations/001_init.sql + migrations/004_phase2_cols.sql

CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  title             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  system_prompt     TEXT,
  visibility_mode   TEXT NOT NULL DEFAULT 'independent' CHECK(visibility_mode IN ('independent','full')),
  group_mode        TEXT NOT NULL DEFAULT 'parallel' CHECK(group_mode IN ('parallel','relay')),
  default_agent_id  TEXT,
  participants      TEXT NOT NULL DEFAULT '[]',
  folder_id         TEXT REFERENCES folders(id),
  project_id        TEXT REFERENCES projects(id),
  pinned            INTEGER NOT NULL DEFAULT 0,
  archived          INTEGER NOT NULL DEFAULT 0,
  parent_message_id TEXT
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE messages (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id           TEXT NOT NULL,
  role              TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  model_id          TEXT,
  content           TEXT NOT NULL DEFAULT '',
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  status            TEXT NOT NULL DEFAULT 'streaming' CHECK(status IN ('streaming','done','error','aborted','partial')),
  error             TEXT,
  parent_message_id TEXT,
  meta_json         TEXT,
  created_at        INTEGER NOT NULL,
  finished_at       INTEGER
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_turn    ON messages(turn_id);
CREATE INDEX idx_messages_parent  ON messages(parent_message_id);

CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variables_json TEXT,
  tags TEXT
);

CREATE TABLE provider_configs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  model_list_json TEXT,
  params_json TEXT
);

CREATE TABLE provider_secrets (
  provider_config_id TEXT PRIMARY KEY REFERENCES provider_configs(id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

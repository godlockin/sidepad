-- Spec §3.4.2: each migration file is wrapped in a single transaction by the
-- migrator (BEGIN ... COMMIT) along with the user_version bump. A crash mid-
-- migration leaves user_version unchanged, so re-execution is safe; therefore
-- bare CREATE TABLE (no IF NOT EXISTS) is acceptable.

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  system_prompt TEXT,
  visibility_mode TEXT NOT NULL DEFAULT 'independent' CHECK(visibility_mode IN ('independent','full')),
  group_mode TEXT NOT NULL DEFAULT 'parallel' CHECK(group_mode IN ('parallel','relay')),
  folder_id TEXT,
  project_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  parent_message_id TEXT
);

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
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  model_id TEXT,
  content TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('streaming','done','error','aborted','partial')),
  error TEXT,
  parent_message_id TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_turn ON messages(turn_id);

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

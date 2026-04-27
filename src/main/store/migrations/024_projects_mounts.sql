-- Cockpit P1: project as a container with mount points.
ALTER TABLE projects ADD COLUMN cwd_resolution TEXT
  CHECK(cwd_resolution IN ('workspace','inputs','manual') OR cwd_resolution IS NULL);
ALTER TABLE projects ADD COLUMN root_dir TEXT;
ALTER TABLE projects ADD COLUMN created_at INTEGER;
ALTER TABLE projects ADD COLUMN updated_at INTEGER;

CREATE TABLE IF NOT EXISTS mount_points (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('refs','inputs','workspace','outputs','scratch')),
  path TEXT NOT NULL,
  label TEXT,
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mount_points_project ON mount_points(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','done','failed','cancelled')),
  output_dir TEXT,
  scratch_dir TEXT,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

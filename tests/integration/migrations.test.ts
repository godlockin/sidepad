import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { _loadMigrationsFromFs } from '@main/store/db';
import { runMigrations } from '@main/store/migrator';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db, _loadMigrationsFromFs());
  return db;
}

describe('migrations 017 + 018', () => {
  it('creates indexes on mcp_servers, mcp_tool_usage, skills', () => {
    const db = freshDb();
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];
    const names = idx.map((r) => r.name);
    expect(names).toContain('idx_mcp_tool_usage_message');
    expect(names).toContain('idx_mcp_tool_usage_server');
    expect(names).toContain('idx_skills_enabled');
    db.close();
  });

  it('creates session_tools join with composite PK', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(session_tools)').all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ['session_id', 'kind', 'ref_id', 'created_at'].sort(),
    );
    db.close();
  });
});

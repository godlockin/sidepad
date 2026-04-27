// tests/unit/migrator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@main/store/migrator';
import { _loadMigrationsFromFs } from '@main/store/db';

const MIGRATIONS = [
  { version: 1, sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY);' },
  { version: 2, sql: 'CREATE TABLE bar (id INTEGER PRIMARY KEY);' },
];

describe('runMigrations', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); });

  it('starts at user_version 0', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(0);
  });

  it('applies all migrations in order and bumps user_version', () => {
    runMigrations(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
      .toEqual([{ name: 'bar' }, { name: 'foo' }]);
  });

  it('is idempotent — re-running applies nothing new', () => {
    runMigrations(db, MIGRATIONS);
    runMigrations(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('rejects when DB user_version exceeds latest migration', () => {
    db.pragma('user_version = 99');
    expect(() => runMigrations(db, MIGRATIONS)).toThrow(/created by a newer/i);
  });

  it('rolls back on a failing migration', () => {
    const bad = [
      ...MIGRATIONS,
      { version: 3, sql: 'CREATE TABLE bar (id INTEGER PRIMARY KEY);' }, // duplicate → fails
    ];
    expect(() => runMigrations(db, bad)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('024 adds cwd_resolution to projects and creates mount_points + tasks', () => {
    const fresh = new Database(':memory:');
    runMigrations(fresh, _loadMigrationsFromFs());
    const projectCols = fresh.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    expect(projectCols.map(c => c.name)).toContain('cwd_resolution');
    const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('mount_points');
    expect(names).toContain('tasks');
    // role CHECK enforced
    expect(() =>
      fresh.prepare("INSERT INTO mount_points (id, project_id, role, path, created_at) VALUES (?,?,?,?,?)").run(
        'm1', 'p1', 'invalid_role', '/tmp', Date.now()
      )
    ).toThrow();
  });
});

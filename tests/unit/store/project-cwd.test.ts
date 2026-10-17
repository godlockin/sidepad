import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  resolveProjectContext,
  rewriteArgsAgainstCwd,
  formatProjectAddendum,
} from '@main/store/project-cwd';
import { ProjectStore } from '@main/store/project-store';

function openMem(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_dir TEXT,
      cwd_resolution TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE mount_points (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      path TEXT NOT NULL,
      label TEXT,
      read_only INTEGER DEFAULT 0,
      created_at INTEGER
    );
  `);
  return db;
}

describe('resolveProjectContext', () => {
  let db: Database.Database;
  let store: ProjectStore;

  beforeEach(() => {
    db = openMem();
    store = new ProjectStore(db);
  });

  it('uses workspace mount when cwd_resolution=workspace', () => {
    const p = store.createProject({ name: 'P', cwdResolution: 'workspace' });
    store.addMount(p.id, { role: 'refs', path: '/refs' });
    store.addMount(p.id, { role: 'workspace', path: '/work' });
    const ctx = resolveProjectContext(db, p.id)!;
    expect(ctx.cwd).toBe('/work');
    expect(formatProjectAddendum(ctx)).toContain('Working directory: /work');
  });

  it('falls back to rootDir for manual', () => {
    const p = store.createProject({ name: 'P', rootDir: '/manual', cwdResolution: 'manual' });
    const ctx = resolveProjectContext(db, p.id)!;
    expect(ctx.cwd).toBe('/manual');
  });
});

describe('rewriteArgsAgainstCwd', () => {
  it('joins relative path keys', () => {
    const out = rewriteArgsAgainstCwd({ path: 'docs/a.md', query: 'x' }, '/proj');
    expect(out.path).toMatch(/[/\\]proj[/\\]docs[/\\]a\.md$/);
    expect(out.query).toBe('x');
  });
  it('leaves absolute and urls alone', () => {
    expect(rewriteArgsAgainstCwd({ path: '/abs' }, '/proj').path).toBe('/abs');
    expect(rewriteArgsAgainstCwd({ path: 'https://x' }, '/proj').path).toBe('https://x');
  });
  it('no-ops without cwd', () => {
    expect(rewriteArgsAgainstCwd({ path: 'a' }, null)).toEqual({ path: 'a' });
  });
});

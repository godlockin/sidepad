import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@main/store/migrator';
import { _loadMigrationsFromFs } from '@main/store/db';
import { ProjectStore } from '@main/store/project-store';

let db: Database.Database;
let store: ProjectStore;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, _loadMigrationsFromFs());
  store = new ProjectStore(db);
});

describe('ProjectStore', () => {
  it('creates a project with timestamps', () => {
    const p = store.createProject({ name: 'demo' });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('demo');
    expect(p.createdAt).toBeGreaterThan(0);
    expect(p.createdAt).toBe(p.updatedAt);
  });

  it('lists projects in created_at ASC', () => {
    const a = store.createProject({ name: 'a' });
    const b = store.createProject({ name: 'b' });
    expect(store.listProjects().map(p => p.id)).toEqual([a.id, b.id]);
  });

  it('updates name and bumps updated_at', async () => {
    const p = store.createProject({ name: 'old' });
    await new Promise(r => setTimeout(r, 5));
    const u = store.updateProject(p.id, { name: 'new' })!;
    expect(u.name).toBe('new');
    expect(u.updatedAt).toBeGreaterThan(p.updatedAt);
  });

  it('cascades delete to mount_points', () => {
    const p = store.createProject({ name: 'p' });
    store.addMount(p.id, { role: 'inputs', path: '/tmp/x' });
    expect(store.listMounts(p.id)).toHaveLength(1);
    store.deleteProject(p.id);
    expect(store.listMounts(p.id)).toHaveLength(0);
  });

  it('rejects invalid mount role at runtime', () => {
    const p = store.createProject({ name: 'p' });
    expect(() => store.addMount(p.id, { role: 'bogus' as never, path: '/tmp/x' })).toThrow();
  });

  it('addMount with read_only persists boolean', () => {
    const p = store.createProject({ name: 'p' });
    const m = store.addMount(p.id, { role: 'refs', path: '/tmp/refs', readOnly: true });
    expect(m.readOnly).toBe(true);
    expect(store.listMounts(p.id)[0].readOnly).toBe(true);
  });
});

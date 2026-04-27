import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@main/store/migrator';
import { _loadMigrationsFromFs } from '@main/store/db';
import { projectRouter } from '@main/ipc/routers/project-router';

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, _loadMigrationsFromFs());
  (globalThis as any).sidepad = { db };
});

describe('projectRouter', () => {
  it('list returns [] initially', async () => {
    const caller = projectRouter.createCaller({});
    expect(await caller.list()).toEqual([]);
  });

  it('create → list → addMount → listMounts → delete cascades', async () => {
    const caller = projectRouter.createCaller({});
    const p = await caller.create({ name: 'hello' });
    expect((await caller.list())[0].id).toBe(p.id);
    const m = await caller.addMount({ projectId: p.id, role: 'inputs', path: '/tmp/in' });
    expect(m.role).toBe('inputs');
    const mounts = await caller.listMounts({ projectId: p.id });
    expect(mounts).toHaveLength(1);
    await caller.delete({ id: p.id });
    expect(await caller.listMounts({ projectId: p.id })).toEqual([]);
  });

  it('rejects bogus role at zod boundary', async () => {
    const caller = projectRouter.createCaller({});
    const p = await caller.create({ name: 'p' });
    await expect(
      caller.addMount({ projectId: p.id, role: 'bogus' as never, path: '/tmp' }),
    ).rejects.toThrow();
  });
});

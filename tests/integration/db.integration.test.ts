import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openSidepadDb, _loadMigrationsFromFs } from '@main/store/db';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-db-'));
  dbPath = path.join(tmpDir, 'sidepad.db');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('openSidepadDb', () => {
  it('creates a fresh DB at the given path with all migrations applied', () => {
    const db = openSidepadDb(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(18);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t: any) => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('messages');
    expect(names).toContain('provider_secrets');
    expect(names).toContain('mcp_servers');
    expect(names).toContain('skills');
    db.close();
  });

  it('reopens an existing DB without re-running migrations', () => {
    openSidepadDb(dbPath).close();
    const db = openSidepadDb(dbPath);
    expect(db.pragma('user_version', { simple: true })).toBe(18);
    db.close();
  });

  it('detects a corrupt file: backs it up and creates a fresh one', () => {
    fs.writeFileSync(dbPath, 'this is not a sqlite file');
    const db = openSidepadDb(dbPath);
    expect(db.pragma('user_version', { simple: true })).toBe(18);
    const backup = fs.readdirSync(tmpDir).find((f) => f.startsWith('sidepad.db.corrupt-'));
    expect(backup).toBeDefined();
    db.close();
  });
});

describe('_loadMigrationsFromFs', () => {
  it('exposes all SQL migrations in version order with the expected first-table content', () => {
    const ms = _loadMigrationsFromFs();
    expect(ms.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 17, 18]);
    expect(ms[0].sql).toContain('CREATE TABLE sessions');
  });
});

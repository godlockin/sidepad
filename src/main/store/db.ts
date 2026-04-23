import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations, type Migration } from './migrator.js';

// Vite-time inlining: each .sql file becomes a string keyed by relative path.
// Vitest also supports import.meta.glob, so this works in both contexts.
const SQL_MODULES = import.meta.glob('./migrations/*.sql', { as: 'raw', eager: true }) as Record<string, string>;

export function _loadMigrationsFromFs(): Migration[] {
  return Object.entries(SQL_MODULES)
    .map(([file, sql]) => {
      const base = file.split('/').pop()!;
      const m = base.match(/^(\d+)_/);
      if (!m) throw new Error(`migration filename must start with NNN_: ${base}`);
      return { version: parseInt(m[1], 10), sql };
    })
    .sort((a, b) => a.version - b.version);
}

function isValidSqlite(p: string): boolean {
  if (!fs.existsSync(p)) return true;
  try {
    const db = new Database(p, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check', { simple: true });
    db.close();
    return result === 'ok';
  } catch {
    return false;
  }
}

export function openSidepadDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (!isValidSqlite(dbPath)) {
    const backup = `${dbPath}.corrupt-${Date.now()}`;
    fs.renameSync(dbPath, backup);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, _loadMigrationsFromFs());
  return db;
}

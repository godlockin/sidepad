import type Database from 'better-sqlite3';

export interface AppSettingsStore {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
}

interface Row {
  value: string | null;
}

export function createAppSettingsStore(db: Database.Database): AppSettingsStore {
  return {
    getSetting(key) {
      const row = db
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(key) as Row | undefined;
      if (!row) return undefined;
      return row.value ?? undefined;
    },
    setSetting(key, value) {
      db.prepare(
        'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
      ).run(key, value, Date.now());
    },
    deleteSetting(key) {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    },
  };
}

/**
 * Convenience helper that reads a setting directly from a db handle without
 * constructing a store. Used by mcp launch sites that only need one read.
 */
export function readAppSetting(
  db: Database.Database,
  key: string,
): string | undefined {
  return createAppSettingsStore(db).getSetting(key);
}

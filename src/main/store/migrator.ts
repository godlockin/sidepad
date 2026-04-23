import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  sql: string;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const current = db.pragma('user_version', { simple: true }) as number;
  const latest = sorted[sorted.length - 1]?.version ?? 0;

  if (current > latest) {
    throw new Error(
      `Database was created by a newer sidepad (user_version=${current}, app expects <=${latest}). Refusing to run.`,
    );
  }

  for (const m of sorted) {
    if (m.version <= current) continue;
    const tx = db.transaction((sql: string, version: number) => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    });
    tx(m.sql, m.version);
  }
}

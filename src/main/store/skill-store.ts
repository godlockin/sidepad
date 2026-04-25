import type Database from 'better-sqlite3';
import type { SkillManifest, SkillRecord } from '../skills/types.js';

interface Row {
  id: string;
  name: string;
  description: string | null;
  manifest_json: string | null;
  source: string | null;
  enabled: number;
  created_at: number;
}

function rowToRecord(r: Row): SkillRecord {
  const manifest: SkillManifest = r.manifest_json
    ? (JSON.parse(r.manifest_json) as SkillManifest)
    : { name: r.name };
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? manifest.description,
    manifest,
    body: typeof (manifest as unknown as { body?: string }).body === 'string'
      ? ((manifest as unknown as { body?: string }).body as string)
      : '',
    source: (r.source as 'bundled' | 'user') ?? 'user',
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}

export interface SkillStore {
  list(): SkillRecord[];
  get(id: string): SkillRecord | undefined;
  upsert(record: SkillRecord): void;
  setEnabled(id: string, enabled: boolean): void;
  remove(id: string): void;
  syncFromDisk(records: SkillRecord[]): void;
}

export function createSkillStore(db: Database.Database): SkillStore {
  const store: SkillStore = {
    list() {
      const rows = db
        .prepare('SELECT * FROM skills ORDER BY created_at ASC')
        .all() as Row[];
      return rows.map(rowToRecord);
    },
    get(id) {
      const r = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Row | undefined;
      return r ? rowToRecord(r) : undefined;
    },
    upsert(record) {
      const existing = db
        .prepare('SELECT enabled FROM skills WHERE id = ?')
        .get(record.id) as { enabled: number } | undefined;
      // Persist body alongside the manifest so we can round-trip through DB.
      const manifestWithBody = { ...record.manifest, body: record.body };
      const enabledVal = existing
        ? existing.enabled
        : record.enabled
        ? 1
        : 0;
      if (existing) {
        db.prepare(
          'UPDATE skills SET name=?, description=?, manifest_json=?, source=? WHERE id=?',
        ).run(
          record.name,
          record.description ?? null,
          JSON.stringify(manifestWithBody),
          record.source,
          record.id,
        );
      } else {
        db.prepare(
          'INSERT INTO skills (id,name,description,manifest_json,source,enabled,created_at) VALUES (?,?,?,?,?,?,?)',
        ).run(
          record.id,
          record.name,
          record.description ?? null,
          JSON.stringify(manifestWithBody),
          record.source,
          enabledVal,
          record.createdAt,
        );
      }
    },
    setEnabled(id, enabled) {
      db.prepare('UPDATE skills SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
    },
    remove(id) {
      db.prepare('DELETE FROM skills WHERE id=?').run(id);
    },
    syncFromDisk(records) {
      const seen = new Set<string>();
      for (const rec of records) {
        store.upsert(rec);
        seen.add(rec.id);
      }
      // Remove stale rows whose source matches loaded sources but file disappeared.
      const allIds = new Set(records.map((r) => r.id));
      const rows = db.prepare('SELECT id, source FROM skills').all() as {
        id: string;
        source: string | null;
      }[];
      for (const r of rows) {
        // Only prune rows whose ids look like our `source:slug` convention and
        // were not present in this load — never touch unrelated rows.
        if ((r.id.startsWith('bundled:') || r.id.startsWith('user:')) && !allIds.has(r.id)) {
          db.prepare('DELETE FROM skills WHERE id=?').run(r.id);
        }
      }
      void seen;
    },
  };
  return store;
}

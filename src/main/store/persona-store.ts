import type Database from 'better-sqlite3';

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function now(): number {
  return Date.now();
}

export const DEFAULT_PERSONA_ID = '_default';

export class PersonaStore {
  constructor(private db: Database.Database) {}

  list(): Persona[] {
    return (this.db.prepare('SELECT * FROM personas ORDER BY created_at ASC').all() as any[]).map(rowToPersona);
  }

  get(id: string): Persona | null {
    const row = this.db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any | undefined;
    return row ? rowToPersona(row) : null;
  }

  create(input: { name: string; prompt: string; id?: string }): Persona {
    const id = input.id ?? uuid();
    const t = now();
    this.db
      .prepare(
        'INSERT INTO personas (id, name, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.prompt, t, t);
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Pick<Persona, 'name' | 'prompt'>>): Persona | null {
    const existing = this.get(id);
    if (!existing) return null;
    const name = patch.name ?? existing.name;
    const prompt = patch.prompt ?? existing.prompt;
    this.db
      .prepare('UPDATE personas SET name = ?, prompt = ?, updated_at = ? WHERE id = ?')
      .run(name, prompt, now(), id);
    return this.get(id);
  }

  delete(id: string): boolean {
    if (id === DEFAULT_PERSONA_ID) return false; // protect default
    const result = this.db.prepare('DELETE FROM personas WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

function rowToPersona(row: any): Persona {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

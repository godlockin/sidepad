import type Database from 'better-sqlite3';
import type { Project, MountPoint, MountRole } from './types.js';

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function now(): number {
  return Date.now();
}

export class ProjectStore {
  constructor(private db: Database.Database) {}

  // --- projects ---
  listProjects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY created_at ASC, id ASC').all() as any[])
      .map(rowToProject);
  }
  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any | undefined;
    return row ? rowToProject(row) : null;
  }
  createProject(input: { name: string; rootDir?: string; cwdResolution?: Project['cwdResolution'] }): Project {
    const id = uuid();
    const t = now();
    this.db
      .prepare('INSERT INTO projects (id, name, root_dir, cwd_resolution, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, input.name, input.rootDir ?? null, input.cwdResolution ?? null, t, t);
    return this.getProject(id)!;
  }
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'rootDir' | 'cwdResolution'>>): Project | null {
    const existing = this.getProject(id);
    if (!existing) return null;
    const name = patch.name ?? existing.name;
    const rootDir = patch.rootDir === undefined ? existing.rootDir : patch.rootDir;
    const cwdResolution = patch.cwdResolution === undefined ? existing.cwdResolution : patch.cwdResolution;
    this.db
      .prepare('UPDATE projects SET name = ?, root_dir = ?, cwd_resolution = ?, updated_at = ? WHERE id = ?')
      .run(name, rootDir, cwdResolution, now(), id);
    return this.getProject(id);
  }
  deleteProject(id: string): boolean {
    const r = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return r.changes > 0;
  }

  // --- mount points ---
  listMounts(projectId: string): MountPoint[] {
    return (this.db.prepare('SELECT * FROM mount_points WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[])
      .map(rowToMount);
  }
  addMount(
    projectId: string,
    input: { role: MountRole; path: string; label?: string; readOnly?: boolean },
  ): MountPoint {
    const id = uuid();
    this.db
      .prepare('INSERT INTO mount_points (id, project_id, role, path, label, read_only, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, input.role, input.path, input.label ?? null, input.readOnly ? 1 : 0, now());
    const row = this.db.prepare('SELECT * FROM mount_points WHERE id = ?').get(id) as any;
    return rowToMount(row);
  }
  removeMount(id: string): boolean {
    const r = this.db.prepare('DELETE FROM mount_points WHERE id = ?').run(id);
    return r.changes > 0;
  }
}

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    rootDir: r.root_dir ?? null,
    cwdResolution: r.cwd_resolution ?? null,
    createdAt: r.created_at ?? 0,
    updatedAt: r.updated_at ?? 0,
  };
}
function rowToMount(r: any): MountPoint {
  return {
    id: r.id,
    projectId: r.project_id,
    role: r.role,
    path: r.path,
    label: r.label ?? null,
    readOnly: !!r.read_only,
    createdAt: r.created_at,
  };
}

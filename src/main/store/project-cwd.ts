import { isAbsolute, join } from 'node:path';
import type Database from 'better-sqlite3';
import { ProjectStore } from './project-store.js';
import type { MountPoint, Project } from './types.js';

export interface ProjectContext {
  project: Project;
  cwd: string | null;
  mounts: MountPoint[];
}

/**
 * Resolve the working directory for a project from cwd_resolution + mounts.
 * - workspace / inputs → first mount with that role
 * - manual → project.rootDir
 * - unset → first workspace mount, else first mount, else rootDir
 */
export function resolveProjectContext(
  db: Database.Database,
  projectId: string,
): ProjectContext | null {
  const store = new ProjectStore(db);
  const project = store.getProject(projectId);
  if (!project) return null;
  const mounts = store.listMounts(projectId);
  let cwd: string | null = null;
  const mode = project.cwdResolution;
  if (mode === 'manual') {
    cwd = project.rootDir;
  } else if (mode === 'workspace' || mode === 'inputs') {
    cwd = mounts.find((m) => m.role === mode)?.path ?? null;
  }
  if (!cwd) {
    cwd =
      mounts.find((m) => m.role === 'workspace')?.path ??
      mounts[0]?.path ??
      project.rootDir ??
      null;
  }
  return { project, cwd, mounts };
}

/** Rewrite common path-like tool args that are relative against project cwd. */
export function rewriteArgsAgainstCwd(
  args: Record<string, unknown>,
  cwd: string | null,
): Record<string, unknown> {
  if (!cwd) return args;
  const keys = ['path', 'file', 'filepath', 'filename', 'dir', 'directory', 'root', 'folder'];
  const out: Record<string, unknown> = { ...args };
  for (const key of keys) {
    const v = out[key];
    if (typeof v === 'string' && v.length > 0 && !isAbsolute(v) && !/^[a-z]+:\/\//i.test(v)) {
      out[key] = join(cwd, v);
    }
  }
  return out;
}

export function formatProjectAddendum(ctx: ProjectContext): string {
  const lines = [`## Project workspace: ${ctx.project.name}`];
  if (ctx.cwd) lines.push(`Working directory: ${ctx.cwd}`);
  if (ctx.mounts.length > 0) {
    lines.push('Mounts:');
    for (const m of ctx.mounts) {
      const ro = m.readOnly ? ' (read-only)' : '';
      const label = m.label ? ` — ${m.label}` : '';
      lines.push(`- [${m.role}] ${m.path}${label}${ro}`);
    }
  }
  lines.push(
    'Prefer paths under these mounts. Relative paths in tool calls resolve against the working directory.',
  );
  return lines.join('\n');
}

import { isAbsolute, relative, resolve } from 'node:path';

export const SANDBOX_SETTING_KEY = 'tool_sandbox_mode';

export type SandboxMode = 'off' | 'project';

export class SandboxViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolation';
  }
}

const PATH_KEYS = ['path', 'file', 'filepath', 'filename', 'dir', 'directory', 'root', 'folder', 'cwd'];

export function parseSandboxMode(raw: string | undefined | null): SandboxMode {
  return raw === 'off' ? 'off' : 'project';
}

export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Unique absolute roots: project cwd plus every mount path. */
export function sandboxRoots(cwd: string | null, mountPaths: string[]): string[] {
  const roots = new Set<string>();
  if (cwd?.trim()) roots.add(resolve(cwd));
  for (const p of mountPaths) {
    if (p?.trim()) roots.add(resolve(p));
  }
  return [...roots];
}

/**
 * Resolve relative path-like args against cwd, then reject any that leave the roots.
 * Non-path fields are left unchanged.
 */
export function jailToolArgs(
  args: Record<string, unknown>,
  roots: string[],
  cwd: string | null,
): Record<string, unknown> {
  if (roots.length === 0) {
    throw new SandboxViolation('Sandbox is on but this chat has no project directory');
  }
  const out: Record<string, unknown> = { ...args };
  for (const key of PATH_KEYS) {
    const v = out[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    if (/^[a-z]+:\/\//i.test(v)) continue;
    const abs = isAbsolute(v) ? resolve(v) : resolve(cwd ?? roots[0]!, v);
    if (!roots.some((root) => isInsideRoot(root, abs))) {
      throw new SandboxViolation(`Path "${v}" is outside the project sandbox`);
    }
    out[key] = abs;
  }
  return out;
}

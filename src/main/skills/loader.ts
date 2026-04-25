import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { SkillManifest, SkillRecord } from './types.js';

function defaultBundledDir(): string {
  // ESM: derive from import.meta.url. Resolves from compiled out/main/skills/loader.js
  // up to repo root + resources/skills.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', 'resources', 'skills');
  } catch {
    return path.resolve(process.cwd(), 'resources', 'skills');
  }
}

function defaultUserDir(): string {
  return path.join(os.homedir(), '.config', 'sidepad', 'skills');
}

export interface SkillLoaderPaths {
  bundledDir?: string;
  userDir?: string;
}

export function getDefaultSkillPaths(): Required<SkillLoaderPaths> {
  return {
    bundledDir: defaultBundledDir(),
    userDir: defaultUserDir(),
  };
}

export function loadSkillsFromDisk(paths?: SkillLoaderPaths): SkillRecord[] {
  const bundledDir = paths?.bundledDir ?? defaultBundledDir();
  const userDir = paths?.userDir ?? defaultUserDir();
  const out: SkillRecord[] = [];
  const dirs: Array<[string, 'bundled' | 'user']> = [
    [bundledDir, 'bundled'],
    [userDir, 'user'],
  ];
  for (const [dir, source] of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    for (const file of entries) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const parsed = matter(raw);
        const manifest = parsed.data as SkillManifest;
        if (!manifest || typeof manifest.name !== 'string' || manifest.name.length === 0) continue;
        out.push({
          id: `${source}:${file.replace(/\.md$/, '')}`,
          name: manifest.name,
          description: manifest.description,
          manifest,
          body: parsed.content,
          source,
          enabled: false,
          createdAt: Date.now(),
        });
      } catch {
        // skip malformed file
      }
    }
  }
  return out;
}

export function writeUserSkill(
  paths: SkillLoaderPaths | undefined,
  filename: string,
  manifest: SkillManifest,
  body: string,
): { id: string; filePath: string } {
  const userDir = paths?.userDir ?? defaultUserDir();
  fs.mkdirSync(userDir, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.md$/, '');
  const filePath = path.join(userDir, `${safeName}.md`);
  const fm = matter.stringify(body ?? '', manifest as unknown as Record<string, unknown>);
  fs.writeFileSync(filePath, fm, 'utf8');
  return { id: `user:${safeName}`, filePath };
}

export function deleteUserSkill(
  paths: SkillLoaderPaths | undefined,
  id: string,
): boolean {
  if (!id.startsWith('user:')) return false;
  const slug = id.slice('user:'.length);
  const userDir = paths?.userDir ?? defaultUserDir();
  const filePath = path.join(userDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function userSkillFilePath(paths: SkillLoaderPaths | undefined, id: string): string | null {
  if (!id.startsWith('user:')) return null;
  const slug = id.slice('user:'.length);
  const userDir = paths?.userDir ?? defaultUserDir();
  return path.join(userDir, `${slug}.md`);
}

import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createSkillStore } from '../../store/skill-store.js';
import {
  loadSkillsFromDisk,
  writeUserSkill,
  deleteUserSkill,
  userSkillFilePath,
  getDefaultSkillPaths,
} from '../../skills/loader.js';
import type { SkillManifest } from '../../skills/types.js';

const t = initTRPC.create({ isServer: true });

function getDb(): Database.Database {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return db;
}

let didSync = false;
function ensureSynced(): void {
  if (didSync) return;
  const db = getDb();
  const store = createSkillStore(db);
  const paths = getDefaultSkillPaths();
  store.syncFromDisk(loadSkillsFromDisk(paths));
  didSync = true;
}

const ManifestInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  system_prompt_addendum: z.string().optional(),
  recommended_tools: z.array(z.string()).optional(),
});

export const skillsRouter = t.router({
  list: t.procedure.query(() => {
    ensureSynced();
    return createSkillStore(getDb()).list();
  }),

  setEnabled: t.procedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      ensureSynced();
      createSkillStore(getDb()).setEnabled(input.id, input.enabled);
      return { ok: true };
    }),

  create: t.procedure
    .input(
      z.object({
        slug: z.string().min(1).optional(),
        manifest: ManifestInput,
        body: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      ensureSynced();
      const slug =
        input.slug ?? input.manifest.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const paths = getDefaultSkillPaths();
      writeUserSkill(paths, slug, input.manifest, input.body ?? '');
      const store = createSkillStore(getDb());
      store.syncFromDisk(loadSkillsFromDisk(paths));
      const id = `user:${slug.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.md$/, '')}`;
      return store.get(id) ?? null;
    }),

  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        manifest: ManifestInput,
        body: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      ensureSynced();
      if (!input.id.startsWith('user:')) {
        throw new Error('Cannot edit bundled skill');
      }
      const slug = input.id.slice('user:'.length);
      const paths = getDefaultSkillPaths();
      writeUserSkill(paths, slug, input.manifest, input.body ?? '');
      const store = createSkillStore(getDb());
      store.syncFromDisk(loadSkillsFromDisk(paths));
      return store.get(input.id) ?? null;
    }),

  remove: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      ensureSynced();
      if (!input.id.startsWith('user:')) {
        throw new Error('Cannot remove bundled skill');
      }
      const paths = getDefaultSkillPaths();
      deleteUserSkill(paths, input.id);
      const store = createSkillStore(getDb());
      store.remove(input.id);
      return { ok: true };
    }),

  // Optional helper for UI to show file path for a user skill
  filePath: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const paths = getDefaultSkillPaths();
      return userSkillFilePath(paths, input.id);
    }),
});

// Suppress unused-warning noise on SkillManifest (re-exported via types).
export type _UnusedSkillManifest = SkillManifest;

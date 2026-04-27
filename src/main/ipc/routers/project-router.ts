import type Database from 'better-sqlite3';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { ProjectStore } from '../../store/project-store.js';

const t = initTRPC.create({ isServer: true });

function getStore(): ProjectStore {
  const db = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!db) throw new Error('Database not available');
  return new ProjectStore(db);
}

const MountRoleSchema = z.enum(['refs', 'inputs', 'workspace', 'outputs', 'scratch']);
const CwdResolutionSchema = z.enum(['workspace', 'inputs', 'manual']).nullable();

export const projectRouter = t.router({
  list: t.procedure.query(() => getStore().listProjects()),

  get: t.procedure.input(z.object({ id: z.string() })).query(({ input }) => getStore().getProject(input.id)),

  create: t.procedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        rootDir: z.string().optional(),
        cwdResolution: CwdResolutionSchema.optional(),
      }),
    )
    .mutation(({ input }) => getStore().createProject(input)),

  update: t.procedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: z.string().min(1).max(120).optional(),
          rootDir: z.string().nullable().optional(),
          cwdResolution: CwdResolutionSchema.optional(),
        }),
      }),
    )
    .mutation(({ input }) => getStore().updateProject(input.id, input.patch)),

  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => ({ ok: getStore().deleteProject(input.id) })),

  listMounts: t.procedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => getStore().listMounts(input.projectId)),

  addMount: t.procedure
    .input(
      z.object({
        projectId: z.string(),
        role: MountRoleSchema,
        path: z.string().min(1),
        label: z.string().optional(),
        readOnly: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { projectId, ...rest } = input;
      return getStore().addMount(projectId, rest);
    }),

  removeMount: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => ({ ok: getStore().removeMount(input.id) })),
});

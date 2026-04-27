import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';
import type { Project, MountPoint, MountRole } from '@main/store/types';

interface State {
  projects: Project[];
  mounts: Record<string, MountPoint[]>; // projectId → mounts
  activeProjectId: string | null;
  loaded: boolean;
}

interface Actions {
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  addMount: (
    projectId: string,
    role: MountRole,
    path: string,
    label?: string,
    readOnly?: boolean,
  ) => Promise<void>;
  removeMount: (mountId: string, projectId: string) => Promise<void>;
}

export const useProjectStore = create<State & Actions>((set, get) => ({
  projects: [],
  mounts: {},
  activeProjectId: null,
  loaded: false,

  init: async () => {
    if (get().loaded) return;
    await get().refresh();
    set({ loaded: true });
  },

  refresh: async () => {
    const projects = (await trpc.project.list.query()) as Project[];
    set({ projects });
  },

  selectProject: async (id) => {
    set({ activeProjectId: id });
    if (id && !get().mounts[id]) {
      const mounts = (await trpc.project.listMounts.query({ projectId: id })) as MountPoint[];
      set({ mounts: { ...get().mounts, [id]: mounts } });
    }
  },

  createProject: async (name) => {
    const p = (await trpc.project.create.mutate({ name })) as Project;
    set({ projects: [...get().projects, p] });
    return p;
  },

  deleteProject: async (id) => {
    await trpc.project.delete.mutate({ id });
    const { [id]: _omit, ...rest } = get().mounts;
    set({
      projects: get().projects.filter((p) => p.id !== id),
      mounts: rest,
      activeProjectId: get().activeProjectId === id ? null : get().activeProjectId,
    });
  },

  addMount: async (projectId, role, path, label, readOnly) => {
    const m = (await trpc.project.addMount.mutate({
      projectId,
      role,
      path,
      label,
      readOnly,
    })) as MountPoint;
    set({
      mounts: {
        ...get().mounts,
        [projectId]: [...(get().mounts[projectId] ?? []), m],
      },
    });
  },

  removeMount: async (mountId, projectId) => {
    await trpc.project.removeMount.mutate({ id: mountId });
    set({
      mounts: {
        ...get().mounts,
        [projectId]: (get().mounts[projectId] ?? []).filter((m) => m.id !== mountId),
      },
    });
  },
}));

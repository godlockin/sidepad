import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';

export interface SkillManifest {
  name: string;
  description?: string;
  system_prompt_addendum?: string;
  recommended_tools?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  manifest: SkillManifest;
  body: string;
  source: 'bundled' | 'user';
  enabled: boolean;
  createdAt: number;
}

interface SkillState {
  skills: Skill[];
  loading: boolean;
  loaded: boolean;

  loadSkills: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  createSkill: (input: {
    slug?: string;
    manifest: SkillManifest;
    body?: string;
  }) => Promise<Skill | null>;
  updateSkill: (
    id: string,
    input: { manifest: SkillManifest; body?: string },
  ) => Promise<Skill | null>;
  removeSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  loading: false,
  loaded: false,

  loadSkills: async () => {
    set({ loading: true });
    try {
      const skills = (await trpc.skills.list.query()) as Skill[];
      set({ skills, loaded: true });
    } catch {
      set({ skills: [], loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  setEnabled: async (id, enabled) => {
    await trpc.skills.setEnabled.mutate({ id, enabled });
    await get().loadSkills();
  },

  createSkill: async (input) => {
    const created = (await trpc.skills.create.mutate(input)) as Skill | null;
    await get().loadSkills();
    return created;
  },

  updateSkill: async (id, input) => {
    const updated = (await trpc.skills.update.mutate({ id, ...input })) as Skill | null;
    await get().loadSkills();
    return updated;
  },

  removeSkill: async (id) => {
    await trpc.skills.remove.mutate({ id });
    await get().loadSkills();
  },
}));

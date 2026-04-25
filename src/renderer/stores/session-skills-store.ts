import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';

interface SessionSkillsState {
  // sessionId -> array of attached skill ids
  attached: Record<string, string[]>;
  loading: boolean;

  load: (sessionId: string) => Promise<void>;
  attach: (sessionId: string, skillId: string) => Promise<void>;
  detach: (sessionId: string, skillId: string) => Promise<void>;
}

export const useSessionSkillsStore = create<SessionSkillsState>((set, get) => ({
  attached: {},
  loading: false,

  load: async (sessionId) => {
    set({ loading: true });
    try {
      const ids = (await trpc.session.listAttachedSkills.query({ sessionId })) as string[];
      set({ attached: { ...get().attached, [sessionId]: ids } });
    } catch {
      set({ attached: { ...get().attached, [sessionId]: [] } });
    } finally {
      set({ loading: false });
    }
  },

  attach: async (sessionId, skillId) => {
    await trpc.session.attachSkill.mutate({ sessionId, skillId });
    await get().load(sessionId);
  },

  detach: async (sessionId, skillId) => {
    await trpc.session.detachSkill.mutate({ sessionId, skillId });
    await get().load(sessionId);
  },
}));

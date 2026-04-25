import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';

interface SessionToolsState {
  // sessionId -> array of attached tool names
  attached: Record<string, string[]>;
  loading: boolean;

  load: (sessionId: string) => Promise<void>;
  attach: (sessionId: string, toolName: string) => Promise<void>;
  detach: (sessionId: string, toolName: string) => Promise<void>;
}

export const useSessionToolsStore = create<SessionToolsState>((set, get) => ({
  attached: {},
  loading: false,

  load: async (sessionId) => {
    set({ loading: true });
    try {
      const names = (await trpc.session.listAttachedTools.query({ sessionId })) as string[];
      set({ attached: { ...get().attached, [sessionId]: names } });
    } catch {
      set({ attached: { ...get().attached, [sessionId]: [] } });
    } finally {
      set({ loading: false });
    }
  },

  attach: async (sessionId, toolName) => {
    await trpc.session.attachTool.mutate({ sessionId, toolName });
    await get().load(sessionId);
  },

  detach: async (sessionId, toolName) => {
    await trpc.session.detachTool.mutate({ sessionId, toolName });
    await get().load(sessionId);
  },
}));

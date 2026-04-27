import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';
import type { Session } from '../../shared/types';
import { getQueryClient } from '../lib/query-client';
import { messagesKey } from '../hooks/useMessages';
import { useSettingsStore } from './settings-store';

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  activeSession: Session | null;
  loading: boolean;

  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  setSessionIcon: (id: string, kind: 'emoji' | 'image' | null, value: string | null) => Promise<void>;
  forkSession: (parentMessageId: string, title?: string) => Promise<Session>;
  setParticipantPersona: (agentId: string, personaId: string) => Promise<void>;
  refreshActiveSession: () => Promise<void>;
  set: (partial: Partial<SessionState>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  loading: false,

  loadSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await trpc.session.list.query();
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectSession: async (id: string) => {
    const session = await trpc.session.get.query({ id });
    set({ activeSessionId: id, activeSession: session });
    // Invalidate so useMessages re-fetches for the new session
    void getQueryClient().invalidateQueries({ queryKey: messagesKey(id) });
  },

  createSession: async (title?: string) => {
    const firstProvider = useSettingsStore.getState().providers[0];
    const session = await trpc.session.create.mutate({
      title,
      defaultAgentId: firstProvider?.id,
    });
    const { sessions } = get();
    set({
      sessions: [session, ...sessions],
      activeSessionId: session.id,
      activeSession: session,
    });
    // Clear messages cache for new session (nothing there yet)
    getQueryClient().setQueryData(messagesKey(session.id), []);
    return session;
  },

  deleteSession: async (id: string) => {
    await trpc.session.delete.mutate({ id });
    const { sessions, activeSessionId, activeSession } = get();
    set({
      sessions: sessions.filter((s) => s.id !== id),
      activeSessionId: activeSessionId === id ? null : activeSessionId,
      activeSession: activeSessionId === id ? null : activeSession,
    });
  },

  renameSession: async (id: string, title: string) => {
    await trpc.session.rename.mutate({ id, title });
    const { sessions } = get();
    set({
      sessions: sessions.map((s) => (s.id === id ? { ...s, title } : s)),
    });
  },

  setSessionIcon: async (id, kind, value) => {
    const updated = await trpc.session.setIcon.mutate({ sessionId: id, kind, value });
    const { sessions, activeSession } = get();
    set({
      sessions: sessions.map((s) => (s.id === id ? updated : s)),
      activeSession: activeSession?.id === id ? updated : activeSession,
    });
  },

  forkSession: async (parentMessageId: string, title?: string) => {
    const { activeSessionId } = get();
    if (!activeSessionId) throw new Error('No active session');
    const forked = await trpc.session.fork.mutate({ sessionId: activeSessionId, parentMessageId, title });
    const { sessions } = get();
    set({
      sessions: [forked, ...sessions],
      activeSessionId: forked.id,
      activeSession: forked,
    });
    getQueryClient().setQueryData(messagesKey(forked.id), []);
    return forked;
  },

  setParticipantPersona: async (agentId: string, personaId: string) => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    await trpc.session.setParticipantPersona.mutate({
      sessionId: activeSessionId,
      agentId,
      personaId,
    });
    await get().refreshActiveSession();
  },

  refreshActiveSession: async () => {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    try {
      const session = await trpc.session.get.query({ id: activeSessionId });
      set({ activeSession: session });
    } catch {
      // ignore
    }
  },

  set: (partial) => set(partial),
}));

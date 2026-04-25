import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';
import type { Session, Message } from '../../main/store/types';
import { useChatStore } from './chat-store';

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  activeSession: Session | null;
  messages: Message[];
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
  setMessages: (msgs: Message[]) => void;
  set: (partial: Partial<SessionState>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  messages: [],
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
    const [session, messages] = await Promise.all([
      trpc.session.get.query({ id }),
      trpc.session.messages.query({ sessionId: id }),
    ]);
    set({ activeSessionId: id, activeSession: session, messages });
    useChatStore.getState().setMessages(messages);
  },

  createSession: async (title?: string) => {
    const session = await trpc.session.create.mutate({ title });
    const { sessions } = get();
    set({
      sessions: [session, ...sessions],
      activeSessionId: session.id,
      activeSession: session,
      messages: [],
    });
    useChatStore.getState().setMessages([]);
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
      messages: [],
    });
    useChatStore.getState().setMessages([]);
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

  setMessages: (msgs: Message[]) => set({ messages: msgs }),

  set: (partial) => set(partial),
}));

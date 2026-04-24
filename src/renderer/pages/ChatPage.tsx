import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { PersonaPicker } from '../components/PersonaPicker';
import { trpc } from '../lib/trpc-client';

export function ChatPage() {
  const { t } = useTranslation();
  const { sessions, activeSessionId, activeSession: storeActive, loadSessions } = useSessionStore();
  const { sendMessage, stopStreaming, streaming, messages } = useChatStore();
  const { providers } = useSettingsStore();
  const personas = usePersonaStore((s) => s.personas);
  const loadPersonas = usePersonaStore((s) => s.loadPersonas);
  const setParticipantPersona = useSessionStore((s) => s.setParticipantPersona);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerPicker, setHeaderPicker] = useState<{
    agentId: string;
    anchor: { top: number; left: number };
  } | null>(null);

  useEffect(() => {
    loadSessions();
    loadPersonas();
  }, [loadSessions, loadPersonas]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
    }
  }, [messages, streaming]);

  const activeSession = storeActive ?? sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleSend = async (text: string, mentions: string[]) => {
    if (!activeSessionId) {
      const session = await useSessionStore.getState().createSession();
      await sendMessage(session.id, text, mentions);
      return;
    }
    await sendMessage(activeSessionId, text, mentions);
  };

  const handleVisibilityChange = async (mode: 'independent' | 'full') => {
    if (!activeSessionId) return;
    await trpc.session.setVisibilityMode.mutate({ sessionId: activeSessionId, mode });
    useSessionStore.getState().selectSession(activeSessionId);
  };

  const handleEditInPlace = async (msgId: string, newContent: string) => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const updated = messages
      .map((m, i) => (i === idx ? { ...m, content: newContent } : m))
      .slice(0, idx + 1);
    useChatStore.getState().setMessages(updated);
  };

  const handleFork = async (msgId: string, _content: string, title?: string) => {
    if (!activeSessionId) return;
    const forked = await trpc.session.fork.mutate({
      sessionId: activeSessionId,
      parentMessageId: msgId,
      title,
    });
    await useSessionStore.getState().loadSessions();
    await useSessionStore.getState().selectSession(forked.id);
  };

  const providerList = providers.map((p) => ({ id: p.id, configId: p.configId }));

  return (
    <div className="flex h-full">
      <Sidebar />
      <section className="flex-1 flex flex-col bg-paper min-w-0">
        {/* Header */}
        <header className="px-6 h-12 border-b border-rule flex items-center justify-between gap-4 bg-surface">
          <h2 className="text-[14px] font-medium text-ink truncate">
            {activeSession?.title || (
              <span className="text-ink-faint font-normal">{t('chat.newConversation')}</span>
            )}
          </h2>
          {activeSession && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">
                {t('chat.visibility')}
              </span>
              <select
                value={activeSession.visibilityMode}
                onChange={(e) =>
                  handleVisibilityChange(e.target.value as 'independent' | 'full')
                }
                className="bg-surface border border-rule rounded-[6px] text-[12px] text-ink px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
              >
                <option value="independent">{t('chat.visibilityIndependent')}</option>
                <option value="full">{t('chat.visibilityFull')}</option>
              </select>
            </div>
          )}
        </header>

        {activeSession && activeSession.participants && activeSession.participants.length > 0 && (
          <div className="px-6 py-2 border-b border-rule flex flex-wrap items-center gap-2 bg-surface">
            <span className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">
              {t('chat.voices')}
            </span>
            {activeSession.participants.map((p) => {
              const persona = personas.find((pp) => pp.id === p.personaId);
              const personaLabel =
                p.personaId !== DEFAULT_PERSONA_ID && persona ? ` · ${persona.name}` : '';
              return (
                <button
                  key={p.agentId}
                  type="button"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setHeaderPicker({
                      agentId: p.agentId,
                      anchor: { top: rect.bottom + 6, left: rect.left },
                    });
                  }}
                  className="inline-flex items-center text-[12px] rounded-full bg-surface-2 border border-rule px-2.5 py-0.5 text-ink hover:border-accent hover:text-accent cursor-pointer transition-colors"
                  title={t('chat.changePersona')}
                >
                  <span className="font-medium">@{p.agentId}</span>
                  {personaLabel && (
                    <span className="text-ink-muted ml-1">{personaLabel}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {headerPicker && (
          <PersonaPicker
            currentPersonaId={
              activeSession?.participants?.find((p) => p.agentId === headerPicker.agentId)
                ?.personaId ?? DEFAULT_PERSONA_ID
            }
            anchor={headerPicker.anchor}
            onSelect={async (personaId) => {
              await setParticipantPersona(headerPicker.agentId, personaId);
              setHeaderPicker(null);
            }}
            onClose={() => setHeaderPicker(null)}
          />
        )}

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-6 pt-6 pb-10">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center text-accent text-[20px] mb-4">
                  ✦
                </div>
                <p className="text-[14px] text-ink-muted max-w-[42ch]">
                  {t('chat.emptyStart')}{' '}
                  <span className="font-mono text-accent text-[12px] bg-accent-muted px-1.5 py-[1px] rounded-[4px]">@</span>{' '}
                  {t('chat.emptyEnd')}
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                index={i}
                onEditInPlace={handleEditInPlace}
                onFork={handleFork}
              />
            ))}
          </div>
        </div>

        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          disabled={!activeSessionId && sessions.length === 0}
          providers={providerList}
        />
      </section>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { Eyebrow } from '../components/ui';
import { trpc } from '../lib/trpc-client';

export function ChatPage() {
  const { sessions, activeSessionId, loadSessions } = useSessionStore();
  const { sendMessage, stopStreaming, streaming, messages } = useChatStore();
  const { providers } = useSettingsStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Auto-scroll to bottom on new messages / streaming tokens
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
    }
  }, [messages, streaming]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

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
    // Refresh sidebar so the new session shows up, then activate it.
    await useSessionStore.getState().loadSessions();
    await useSessionStore.getState().selectSession(forked.id);
  };

  const providerList = providers.map((p) => ({ id: p.id, configId: p.configId }));

  return (
    <div className="flex h-full">
      <Sidebar />
      <section className="flex-1 flex flex-col bg-paper min-w-0">
        {/* Per-session header — editorial dateline */}
        <header className="px-8 pt-6 pb-4 border-b border-rule flex items-baseline justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Eyebrow>
              {activeSession
                ? `session · ${new Date(activeSession.createdAt).toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                  })}`
                : 'no session'}
            </Eyebrow>
            <h2
              className="mt-1 font-display text-[26px] leading-[1.15] tracking-tighter text-ink truncate"
              style={{
                fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'WONK' 1",
                fontStyle: activeSession?.title ? 'italic' : 'normal',
              }}
            >
              {activeSession?.title || (
                <span className="text-ink-faint">An unwritten page.</span>
              )}
            </h2>
          </div>
          {activeSession && (
            <div className="flex items-baseline gap-3 shrink-0">
              <Eyebrow>visibility</Eyebrow>
              <select
                value={activeSession.visibilityMode}
                onChange={(e) =>
                  handleVisibilityChange(e.target.value as 'independent' | 'full')
                }
                className="bg-transparent border-0 border-b border-rule font-mono text-xxs uppercase tracking-[0.14em] text-ink px-0 py-1 pr-5 cursor-pointer focus:outline-none focus:border-ink appearance-none bg-no-repeat bg-[right_center] bg-[length:10px]"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='currentColor' fill='none' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
                }}
              >
                <option value="independent">independent</option>
                <option value="full">full</option>
              </select>
            </div>
          )}
        </header>

        {/* Body — centered column like a periodical */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-8 pt-6 pb-16">
            {messages.length === 0 && (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center">
                <span
                  className="font-display text-[56px] leading-[1] tracking-tightest text-ink-faint select-none"
                  style={{
                    fontVariationSettings: "'opsz' 144, 'SOFT' 100, 'WONK' 1",
                    fontStyle: 'italic',
                  }}
                >
                  ¶
                </span>
                <p className="mt-6 font-serif-body italic text-[16px] text-ink-muted max-w-[32ch]">
                  A blank page. Write a line, address a voice with{' '}
                  <span className="text-accent not-italic font-mono text-[13px]">@</span>
                  , or simply begin.
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

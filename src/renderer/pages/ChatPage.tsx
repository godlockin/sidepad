import React, { useEffect } from 'react';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { trpc } from '../lib/trpc-client';

export function ChatPage() {
  const { sessions, activeSessionId, messages, loadSessions, selectSession } = useSessionStore();
  const { sendMessage, stopStreaming, streaming } = useChatStore();
  const { providers } = useSettingsStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col bg-gray-900">
        {/* Per-session header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {activeSession?.title || 'New chat'}
          </h2>
          {activeSession && (
            <div className="flex gap-3">
              <div className="flex items-center gap-1">
                <label className="text-xs text-gray-400">Visibility</label>
                <select
                  value={activeSession.visibilityMode}
                  onChange={(e) => handleVisibilityChange(e.target.value as 'independent' | 'full')}
                  className="bg-gray-800 border border-gray-700 rounded text-xs text-white px-2 py-1"
                >
                  <option value="independent">Independent</option>
                  <option value="full">Full</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>Send a message to start.</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>

        {/* Chat input */}
        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          disabled={!activeSessionId && sessions.length === 0}
          providers={providers}
        />
      </div>
    </div>
  );
}

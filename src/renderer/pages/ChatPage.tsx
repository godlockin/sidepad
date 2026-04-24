import React, { useEffect } from 'react';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';

export function ChatPage() {
  const { sessions, activeSessionId, messages, loadSessions, selectSession } = useSessionStore();
  const { sendMessage, stopStreaming, streaming } = useChatStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleSend = async (text: string, mentions: string[]) => {
    if (!activeSessionId) {
      // Auto-create a session if none is active
      const session = await useSessionStore.getState().createSession();
      await sendMessage(session.id, text, mentions);
      return;
    }
    await sendMessage(activeSessionId, text, mentions);
  };

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col bg-gray-900">
        {/* Per-session header */}
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            {activeSession?.title || 'New chat'}
          </h2>
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
        />
      </div>
    </div>
  );
}

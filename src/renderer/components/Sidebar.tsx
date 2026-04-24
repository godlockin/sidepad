import React, { useState } from 'react';
import { useSessionStore } from '../stores/session-store';

export function Sidebar() {
  const { sessions, activeSessionId, createSession, deleteSession, selectSession } = useSessionStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleNewChat = async () => {
    await createSession();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this session?')) {
      await deleteSession(id);
    }
  };

  const handleDoubleClick = (session: { id: string; title: string | null }) => {
    setEditingId(session.id);
    setEditTitle(session.title || 'Untitled');
  };

  const handleRenameSubmit = async () => {
    if (editingId && editTitle.trim()) {
      // rename will be added in a later task via store method
      setEditingId(null);
    }
  };

  return (
    <div className="w-56 bg-gray-800 border-r border-gray-700 flex flex-col h-full">
      <div className="p-3 border-b border-gray-700">
        <button
          onClick={handleNewChat}
          className="w-full px-3 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-500"
        >
          + New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => selectSession(s.id)}
            onDoubleClick={() => handleDoubleClick(s)}
            className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer text-sm ${
              s.id === activeSessionId
                ? 'bg-blue-600/30 text-white border-l-2 border-blue-500'
                : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {editingId === s.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setEditingId(null); }}
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate flex-1">
                {s.parentMessageId && <span className="text-gray-500 mr-1">↳</span>}
                {s.title || 'Untitled'}
              </span>
            )}
            <button
              onClick={(e) => handleDelete(s.id, e)}
              className="ml-2 text-gray-500 hover:text-red-400 text-lg leading-none"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-gray-500 text-xs px-3 mt-2">No conversations yet.</p>
        )}
      </div>
    </div>
  );
}

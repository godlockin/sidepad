import React, { useState } from 'react';
import { useSessionStore } from '../stores/session-store';

export function Sidebar() {
  const { sessions, activeSessionId, createSession, deleteSession, selectSession, renameSession } =
    useSessionStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this session?')) await deleteSession(id);
  };

  const commitRename = async () => {
    if (editingId && editTitle.trim()) {
      await renameSession(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <aside className="w-[240px] shrink-0 border-r border-rule flex flex-col bg-surface-2">
      {/* Head */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Sessions
        </span>
        <button
          onClick={() => createSession()}
          aria-label="New session"
          className="text-[12px] font-medium text-ink-muted hover:text-accent cursor-pointer transition-colors"
        >
          + new
        </button>
      </div>

      {/* List */}
      <ol className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <li key={s.id} className="group">
              <button
                onClick={() => selectSession(s.id)}
                onDoubleClick={() => {
                  setEditingId(s.id);
                  setEditTitle(s.title || 'Untitled');
                }}
                className={`relative w-full text-left px-3 py-1.5 rounded-[6px] flex items-center gap-2 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active
                    ? 'bg-surface text-ink shadow-sm border border-rule'
                    : 'text-ink-muted hover:text-ink hover:bg-surface'
                }`}
              >
                <span className="flex-1 min-w-0">
                  {editingId === s.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent border-0 px-0 py-0 text-[13px] text-ink focus:outline-none"
                    />
                  ) : (
                    <span className="block truncate text-[13px] leading-[1.35]">
                      {s.parentMessageId && (
                        <span className="text-ink-faint mr-1" title="forked">↳ </span>
                      )}
                      {s.title || <span className="text-ink-faint">Untitled</span>}
                    </span>
                  )}
                </span>

                <span
                  onClick={(e) => handleDelete(s.id, e)}
                  role="button"
                  tabIndex={-1}
                  aria-label="Delete session"
                  className={`text-[14px] leading-none text-ink-faint hover:text-danger cursor-pointer transition-opacity ${
                    active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                  }`}
                >
                  ×
                </span>
              </button>
            </li>
          );
        })}

        {sessions.length === 0 && (
          <li className="px-3 py-8 text-center">
            <p className="text-[12px] text-ink-faint leading-relaxed">
              No conversations yet.
              <br />
              Press{' '}
              <span className="font-mono text-ink-muted bg-surface border border-rule px-1.5 py-[1px] rounded-[4px]">
                + new
              </span>{' '}
              to begin.
            </p>
          </li>
        )}
      </ol>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-rule">
        <span className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          local · zero telemetry
        </span>
      </div>
    </aside>
  );
}

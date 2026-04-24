import React, { useState } from 'react';
import { useSessionStore } from '../stores/session-store';
import { Eyebrow, Rule } from './ui';

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
    <aside className="w-[248px] shrink-0 border-r border-rule flex flex-col bg-paper">
      {/* Head */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <Eyebrow>Sessions · {sessions.length.toString().padStart(2, '0')}</Eyebrow>
        <button
          onClick={() => createSession()}
          aria-label="New session"
          className="font-mono text-xxs uppercase tracking-[0.14em] text-ink-muted hover:text-accent cursor-pointer transition-colors"
        >
          + new
        </button>
      </div>
      <Rule />

      {/* List — hanging indent, no cards */}
      <ol className="flex-1 overflow-y-auto py-2">
        {sessions.map((s, i) => {
          const active = s.id === activeSessionId;
          return (
            <li key={s.id} className="group">
              <button
                onClick={() => selectSession(s.id)}
                onDoubleClick={() => {
                  setEditingId(s.id);
                  setEditTitle(s.title || 'Untitled');
                }}
                className={`relative w-full text-left px-5 py-2.5 flex items-start gap-3 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active ? 'bg-ink/[0.035]' : 'hover:bg-ink/[0.02]'
                }`}
              >
                {/* Gutter number */}
                <span
                  className={`font-mono text-xxs tabular-nums pt-[3px] ${
                    active ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>

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
                      className="w-full bg-transparent border-0 border-b border-ink px-0 py-0 text-[14px] font-serif-body text-ink focus:outline-none"
                    />
                  ) : (
                    <span
                      className={`block truncate font-serif-body text-[14px] leading-[1.35] ${
                        active ? 'text-ink' : 'text-ink-muted group-hover:text-ink'
                      }`}
                    >
                      {s.parentMessageId && (
                        <span className="text-ink-faint mr-1" title="forked">↳ </span>
                      )}
                      {s.title || <span className="italic text-ink-faint">Untitled</span>}
                    </span>
                  )}
                </span>

                {/* Delete, visible on hover or when active */}
                <span
                  onClick={(e) => handleDelete(s.id, e)}
                  role="button"
                  tabIndex={-1}
                  aria-label="Delete session"
                  className={`pt-[3px] font-mono text-xxs text-ink-faint hover:text-danger cursor-pointer transition-opacity ${
                    active ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                  }`}
                >
                  ×
                </span>

                {/* Active accent bar */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent"
                  />
                )}
              </button>
            </li>
          );
        })}

        {sessions.length === 0 && (
          <li className="px-5 py-8 text-center">
            <p className="font-serif-body italic text-[13px] text-ink-faint leading-relaxed">
              No conversations yet.
              <br />
              Press{' '}
              <span className="font-mono not-italic text-ink-muted bg-ink/5 px-1.5 py-[1px] rounded-sm">
                + new
              </span>{' '}
              to begin.
            </p>
          </li>
        )}
      </ol>

      {/* Footer colophon */}
      <div className="px-5 py-3 border-t border-rule">
        <Eyebrow className="!text-[9px] !tracking-[0.2em]">
          local · zero telemetry
        </Eyebrow>
      </div>
    </aside>
  );
}

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../stores/session-store';
import { Avatar } from './Avatar';
import { IconEditor } from './IconEditor';

export function Sidebar() {
  const { t } = useTranslation();
  const { sessions, activeSessionId, createSession, deleteSession, selectSession, renameSession, setSessionIcon } =
    useSessionStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [iconEdit, setIconEdit] = useState<{ id: string; anchor: { top: number; left: number } } | null>(null);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('sidebar.confirmDelete'))) await deleteSession(id);
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
          {t('sidebar.sessions')}
        </span>
        <button
          onClick={() => createSession()}
          aria-label={t('sidebar.newAria')}
          className="text-[12px] font-medium text-ink-muted hover:text-accent cursor-pointer transition-colors"
        >
          {t('sidebar.newShort')}
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
                  setEditTitle(s.title || t('sidebar.untitled'));
                }}
                className={`relative w-full text-left px-3 py-1.5 rounded-[6px] flex items-center gap-2 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active
                    ? 'bg-surface text-ink shadow-sm border border-rule'
                    : 'text-ink-muted hover:text-ink hover:bg-surface'
                }`}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setIconEdit({ id: s.id, anchor: { top: rect.bottom + 6, left: rect.left } });
                  }}
                  title={t('sidebar.changeIcon')}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <Avatar
                    kind={s.iconKind}
                    value={s.iconValue}
                    name={s.title || s.id}
                    size={20}
                    rounded="md"
                  />
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
                      className="w-full bg-transparent border-0 px-0 py-0 text-[13px] text-ink focus:outline-none"
                    />
                  ) : (
                    <span className="block truncate text-[13px] leading-[1.35]">
                      {s.parentMessageId && (
                        <span className="text-ink-faint mr-1" title="forked">↳ </span>
                      )}
                      {s.title || <span className="text-ink-faint">{t('sidebar.untitled')}</span>}
                    </span>
                  )}
                </span>

                <span
                  onClick={(e) => handleDelete(s.id, e)}
                  role="button"
                  tabIndex={-1}
                  aria-label={t('sidebar.deleteAria')}
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
              {t('sidebar.emptyLine1')}
              <br />
              {t('sidebar.emptyLine2')}{' '}
              <span className="font-mono text-ink-muted bg-surface border border-rule px-1.5 py-[1px] rounded-[4px]">
                {t('sidebar.newShort')}
              </span>{' '}
              {t('sidebar.emptyLine3')}
            </p>
          </li>
        )}
      </ol>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-rule">
        <span className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          {t('sidebar.footer')}
        </span>
      </div>
      {iconEdit && (() => {
        const sess = sessions.find((s) => s.id === iconEdit.id);
        if (!sess) return null;
        return (
          <IconEditor
            name={sess.title || t('sidebar.untitled')}
            kind={sess.iconKind}
            value={sess.iconValue}
            anchor={iconEdit.anchor}
            onSave={async (k, v) => {
              await setSessionIcon(sess.id, k, v);
            }}
            onClose={() => setIconEdit(null)}
          />
        );
      })()}
    </aside>
  );
}

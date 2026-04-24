import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../main/store/types';
import { EditForkModal } from './EditForkModal';
import { PersonaPicker } from './PersonaPicker';
import { useSessionStore } from '../stores/session-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';

interface MessageBubbleProps {
  message: Message;
  index?: number;
  onEditInPlace?: (msgId: string, newContent: string) => void;
  onFork?: (msgId: string, content: string, title?: string) => void;
}

export function MessageBubble({ message, index = 0, onEditInPlace, onFork }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';
  const meta: { agentId?: string } = message.metaJson ? JSON.parse(message.metaJson) : {};

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const delay = Math.min(index * 30, 180);

  return (
    <>
      <article className="anim-fade-up py-3" style={{ animationDelay: `${delay}ms` }}>
        {isUser ? (
          <UserEntry message={message} />
        ) : (
          <AgentEntry
            message={message}
            meta={meta}
            isError={isError}
            isStreaming={isStreaming}
            copied={copied}
            onCopy={handleCopy}
            onEditFork={() => setShowModal(true)}
          />
        )}
      </article>

      {showModal && (
        <EditForkModal
          message={message}
          onEditInPlace={(c) => {
            onEditInPlace?.(message.id, c);
            setShowModal(false);
          }}
          onFork={(c, t) => {
            onFork?.(message.id, c, t);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function UserEntry({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[68%] bg-accent text-white rounded-2xl px-3.5 py-2 text-[13px] leading-[1.55] whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function AgentEntry({
  message,
  meta,
  isError,
  isStreaming,
  copied,
  onCopy,
  onEditFork,
}: {
  message: Message;
  meta: { agentId?: string };
  isError: boolean;
  isStreaming: boolean;
  copied: boolean;
  onCopy: () => void;
  onEditFork: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group relative">
      {/* Byline */}
      <header className="flex items-center gap-2 mb-1.5">
        <BylineAgent agentId={meta.agentId ?? null} />
        {isStreaming && (
          <span className="text-[11px] font-medium text-accent">{t('messageBubble.writing')}</span>
        )}
        {isError && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-danger">
            {t('messageBubble.error')}
          </span>
        )}
      </header>

      {/* Body */}
      <div
        className={`text-[14px] leading-[1.65] whitespace-pre-wrap ${
          isError ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {message.content}
        {isStreaming && (
          <span className="anim-caret bg-accent h-[1.05em] align-[-2px] translate-y-[2px]">▍</span>
        )}
      </div>

      {/* Error detail */}
      {isError && message.error && (
        <p className="mt-2 font-mono text-[11px] text-danger/80 bg-danger/5 border-l-2 border-danger/40 pl-3 py-1 rounded-r">
          {message.error}
        </p>
      )}

      {/* Actions */}
      {!isStreaming && (
        <footer className="mt-2 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur)]">
          {message.content && (
            <button
              onClick={onCopy}
              className="text-[11px] font-medium text-ink-faint hover:text-accent cursor-pointer transition-colors"
            >
              {copied ? t('messageBubble.copied') : t('messageBubble.copy')}
            </button>
          )}
          {message.status === 'done' && (
            <button
              onClick={onEditFork}
              className="text-[11px] font-medium text-ink-faint hover:text-accent cursor-pointer transition-colors"
            >
              {t('messageBubble.editFork')}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

function BylineAgent({ agentId }: { agentId: string | null }) {
  const { t } = useTranslation();
  const [picker, setPicker] = useState<{ top: number; left: number } | null>(null);
  const activeSession = useSessionStore((s) => s.activeSession);
  const setParticipantPersona = useSessionStore((s) => s.setParticipantPersona);
  const personas = usePersonaStore((s) => s.personas);

  if (!agentId) {
    return <span className="text-[12px] font-medium text-ink-muted">{t('messageBubble.agent')}</span>;
  }

  const personaId =
    activeSession?.participants?.find((p) => p.agentId === agentId)?.personaId ??
    DEFAULT_PERSONA_ID;
  const persona = personas.find((p) => p.id === personaId);
  const showPersona = personaId !== DEFAULT_PERSONA_ID && persona;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPicker({ top: rect.bottom + 6, left: rect.left });
        }}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted hover:text-accent cursor-pointer transition-colors"
        title={t('chat.changePersona')}
      >
        <span className="font-mono text-[11px] bg-surface-2 border border-rule rounded-[4px] px-1.5 py-[1px] text-ink">
          {agentId}
        </span>
        {showPersona && (
          <span className="text-ink-muted">· {persona!.name}</span>
        )}
      </button>
      {picker && (
        <PersonaPicker
          currentPersonaId={personaId}
          anchor={picker}
          onSelect={async (id) => {
            await setParticipantPersona(agentId, id);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

import React, { useState } from 'react';
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

/**
 * Editorial message entry.
 *
 * User messages: right-aligned, italic, em-dash prefixed — like a letter signoff.
 * AI messages: full-width typographic body with a monospace byline.
 * No bubbles. No cards. Just well-set type.
 */
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

  const delay = Math.min(index * 40, 240);

  return (
    <>
      <article
        className="anim-fade-up py-5 first:pt-2"
        style={{ animationDelay: `${delay}ms` }}
      >
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

/* ─── User entry — the prompt, as a margin letter ─────────────── */

function UserEntry({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[68%] text-right">
        <p
          className="font-display italic text-ink text-[17px] leading-[1.55] whitespace-pre-wrap"
          style={{ fontVariationSettings: "'opsz' 40, 'SOFT' 50, 'WONK' 0" }}
        >
          <span className="text-ink-faint not-italic mr-1 select-none">—</span>
          {message.content}
        </p>
      </div>
    </div>
  );
}

/* ─── Agent entry — the response, as an editorial passage ─────── */

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
  return (
    <div className="group relative pl-6 pr-2">
      {/* Left rule — hairline decoration */}
      <span
        aria-hidden
        className={`absolute left-0 top-[9px] bottom-1 w-px ${
          isError ? 'bg-danger/40' : isStreaming ? 'bg-accent' : 'bg-rule-strong'
        }`}
      />

      {/* Byline */}
      <header className="flex items-baseline gap-3 mb-1.5">
        <BylineAgent agentId={meta.agentId ?? null} />
        {isStreaming && (
          <span className="font-mono text-xxs tracking-wider text-accent">
            writing…
          </span>
        )}
        {isError && (
          <span className="font-mono text-xxs uppercase tracking-wider text-danger">
            error
          </span>
        )}
      </header>

      {/* Body */}
      <div
        className={`font-serif-body text-[15.5px] leading-[1.65] whitespace-pre-wrap ${
          isError ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {message.content}
        {isStreaming && <span className="anim-caret bg-accent h-[1.05em] align-[-2px] translate-y-[2px]">▍</span>}
      </div>

      {/* Error detail */}
      {isError && message.error && (
        <p className="mt-2 font-mono text-[11px] text-danger/80 bg-danger/5 border-l-2 border-danger/40 pl-3 py-1">
          {message.error}
        </p>
      )}

      {/* Actions — hover-reveal micro-links */}
      {!isStreaming && (
        <footer className="mt-2 flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur)]">
          {message.content && (
            <button
              onClick={onCopy}
              className="font-mono text-xxs uppercase tracking-[0.14em] text-ink-faint hover:text-accent cursor-pointer transition-colors"
            >
              {copied ? '✓ copied' : 'copy'}
            </button>
          )}
          {message.status === 'done' && (
            <button
              onClick={onEditFork}
              className="font-mono text-xxs uppercase tracking-[0.14em] text-ink-faint hover:text-accent cursor-pointer transition-colors"
            >
              edit / fork ↳
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/* ─── Clickable byline showing agent + persona ─────────────────── */

function BylineAgent({ agentId }: { agentId: string | null }) {
  const [picker, setPicker] = useState<{ top: number; left: number } | null>(null);
  const activeSession = useSessionStore((s) => s.activeSession);
  const setParticipantPersona = useSessionStore((s) => s.setParticipantPersona);
  const personas = usePersonaStore((s) => s.personas);

  if (!agentId) {
    return (
      <span className="font-mono text-xxs uppercase tracking-[0.16em] text-ink">agent</span>
    );
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
        className="font-mono text-xxs uppercase tracking-[0.16em] text-ink hover:text-accent cursor-pointer transition-colors"
        title="Click to change persona"
      >
        {agentId}
        {showPersona && (
          <span className="normal-case tracking-[0.14em] text-ink-faint ml-1">
            · {persona!.name}
          </span>
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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../main/store/types';
import { EditForkModal } from './EditForkModal';
import { PersonaPicker } from './PersonaPicker';
import { useSessionStore } from '../stores/session-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';
import { useChatStore, type ToolCallView } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { Avatar } from './Avatar';

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
  const toolCalls = useChatStore((s) => s.toolCalls.get(message.id) ?? []);
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

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {toolCalls.map((c) => (
            <ToolCallCard key={c.id} call={c} />
          ))}
        </div>
      )}

      {/* Reasoning / thinking */}
      {message.reasoning && message.reasoning.length > 0 && (
        <details className="mb-2">
          <summary className="text-[12px] text-ink-muted cursor-pointer select-none">
            {t('messageBubble.thinking')}
          </summary>
          <div className="mt-1 text-[12px] text-ink-2 border-l-2 border-border pl-3 font-mono whitespace-pre-wrap">
            {message.reasoning}
          </div>
        </details>
      )}

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
      {!isStreaming && !isError && (() => {
        const tok = (message.promptTokens ?? 0) + (message.completionTokens ?? 0);
        const dur =
          message.finishedAt && message.createdAt
            ? `${(message.finishedAt - message.createdAt).toFixed(1)}s`
            : null;
        const parts: string[] = [];
        parts.push(message.modelId ?? '—');
        if (tok > 0) parts.push(`${tok} tok`);
        if (dur) parts.push(dur);
        return (
          <div className="text-[11px] font-mono text-ink-faint mt-1.5">
            {parts.join(' · ')}
          </div>
        );
      })()}
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
  const providers = useSettingsStore((s) => s.providers);

  if (!agentId) {
    return <span className="text-[12px] font-medium text-ink-muted">{t('messageBubble.agent')}</span>;
  }

  const personaId =
    activeSession?.participants?.find((p) => p.agentId === agentId)?.personaId ??
    DEFAULT_PERSONA_ID;
  const persona = personas.find((p) => p.id === personaId);
  const showPersona = personaId !== DEFAULT_PERSONA_ID && persona;
  const provider = providers.find((p) => p.id === agentId);

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
        <Avatar
          kind={provider?.iconKind ?? null}
          value={provider?.iconValue ?? null}
          name={agentId}
          size={18}
          rounded="full"
          fallback="empty"
        />
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

function ToolCallCard({ call }: { call: ToolCallView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = call.status;
  const dot =
    status === 'pending' ? 'bg-accent animate-pulse'
    : status === 'error' ? 'bg-danger'
    : 'bg-success';
  const dur = call.durationMs != null ? `${call.durationMs} ms` : '';
  return (
    <div className="border border-rule rounded-[8px] bg-surface-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-surface transition-colors"
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[12px] text-ink">🔧 {call.name}</span>
        {dur && <span className="text-[11px] text-ink-faint">· {dur}</span>}
        <span className="ml-auto text-[10px] text-ink-faint uppercase tracking-wider">
          {open ? t('chat.toolCall.collapse') : t('chat.toolCall.expand')}
        </span>
      </button>
      {open && (
        <div className="border-t border-rule px-3 py-2 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">
              {t('chat.toolCall.argsLabel')}
            </div>
            <pre className="font-mono text-[11px] text-ink whitespace-pre-wrap break-all bg-surface border border-rule rounded p-2">
              {safeStringify(call.args)}
            </pre>
          </div>
          {(call.result !== undefined || call.isError) && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">
                {call.isError ? t('chat.toolCall.errorLabel') : t('chat.toolCall.resultLabel')}
              </div>
              <pre
                className={`font-mono text-[11px] whitespace-pre-wrap break-all border rounded p-2 ${
                  call.isError
                    ? 'text-danger bg-danger/5 border-danger/30'
                    : 'text-ink bg-surface border-rule'
                }`}
              >
                {safeStringify(call.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

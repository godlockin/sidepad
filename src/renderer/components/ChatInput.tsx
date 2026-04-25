import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MentionPicker } from './MentionPicker';
import { PersonaPicker } from './PersonaPicker';
import { useSessionStore } from '../stores/session-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';
import { trpc } from '../lib/trpc-client';

interface ChatInputProps {
  onSend: (text: string, mentions: string[], attachmentIds: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  providers?: Array<{ id: string; configId: string }>;
  onMentionSelect?: (providerId: string) => void;
}

interface AttachmentChip {
  id: string;
  filename: string;
  sizeBytes: number;
  status: 'parsing' | 'ready' | 'error';
  tokenEstimate?: number;
  error?: string;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}b`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}kb`;
  return `${(b / (1024 * 1024)).toFixed(1)}mb`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  onSend,
  onStop,
  streaming,
  disabled = false,
  providers = [],
  onMentionSelect,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [chipPicker, setChipPicker] = useState<{
    agentId: string;
    anchor: { top: number; left: number };
  } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSession = useSessionStore((s) => s.activeSession);
  const setParticipantPersona = useSessionStore((s) => s.setParticipantPersona);
  const personas = usePersonaStore((s) => s.personas);
  const loadPersonas = usePersonaStore((s) => s.loadPersonas);

  useEffect(() => {
    if (personas.length === 0) loadPersonas();
  }, [personas.length, loadPersonas]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 168) + 'px';
    }
    const lastAt = input.lastIndexOf('@');
    if (lastAt >= 0 && providers.length > 0) {
      const afterAt = input.slice(lastAt + 1);
      if (afterAt === '' || /^[a-zA-Z0-9_-]+$/.test(afterAt)) {
        setShowPicker(true);
        return;
      }
    }
    setShowPicker(false);
  }, [input, providers.length]);

  // Subscribe to parse-status updates for the active session
  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId) return;
    const sub = (trpc as any).attachment.onParsed.subscribe(
      { sessionId },
      {
        onData: (row: any) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === row.id
                ? {
                    ...a,
                    status:
                      row.parse_status === 'ready'
                        ? 'ready'
                        : row.parse_status === 'error'
                          ? 'error'
                          : 'parsing',
                    tokenEstimate: row.token_estimate ?? a.tokenEstimate,
                    error: row.parse_error ?? undefined,
                  }
                : a,
            ),
          );
        },
      },
    );
    return () => sub.unsubscribe();
  }, [activeSession?.id]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const sessionId = activeSession?.id;
      if (!sessionId) return;
      const list = Array.from(files);
      for (const file of list) {
        try {
          const dataBase64 = await fileToBase64(file);
          const res = await (trpc as any).attachment.upload.mutate({
            sessionId,
            filename: file.name,
            mime: file.type || undefined,
            dataBase64,
          });
          setAttachments((prev) => [
            ...prev,
            {
              id: res.id,
              filename: file.name,
              sizeBytes: file.size,
              status: 'parsing',
            },
          ]);
        } catch (err) {
          console.error('attachment upload failed', err);
        }
      }
    },
    [activeSession?.id],
  );

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleAttachUrl = async () => {
    const sessionId = activeSession?.id;
    if (!sessionId) return;
    const url = window.prompt('URL:');
    if (!url) return;
    try {
      const res = await (trpc as any).attachment.fetchUrl.mutate({ sessionId, url });
      setAttachments((prev) => [
        ...prev,
        { id: res.id, filename: url, sizeBytes: 0, status: 'parsing' },
      ]);
    } catch (err) {
      console.error('attachment fetchUrl failed', err);
    }
  };

  const removeAttachment = async (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      await (trpc as any).attachment.delete.mutate({ id });
    } catch {
      /* ignore */
    }
  };

  const handlePickerSelect = (providerId: string) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(before + '@' + providerId + ' ');
    setShowPicker(false);
    textareaRef.current?.focus();
    onMentionSelect?.(providerId);
  };

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    const mentions = extractMentions(input);
    const ids = attachments.map((a) => a.id);
    onSend(input.trim(), mentions, ids);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  const mentions = extractMentions(input);
  const canSend = !disabled && !streaming && input.trim().length > 0;

  return (
    <div className="px-4 pb-4 pt-2 bg-paper">
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          'relative border rounded-[10px] bg-surface focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors ' +
          (dragOver ? 'border-accent ring-1 ring-accent' : 'border-rule')
        }
      >
        {attachments.length > 0 && (
          <div className="px-3 pt-2.5 flex flex-wrap items-center gap-1.5">
            {attachments.map((a) => {
              const statusLabel =
                a.status === 'ready'
                  ? `${t('chat.attachment.ready')}${a.tokenEstimate != null ? ` · ~${a.tokenEstimate} tok` : ''}`
                  : a.status === 'error'
                    ? t('chat.attachment.error')
                    : t('chat.attachment.parsing');
              return (
                <span
                  key={a.id}
                  className="inline-flex items-center text-[12px] rounded-full bg-accent-muted text-accent px-2.5 py-0.5"
                  title={a.error ?? a.filename}
                >
                  <span className="mr-1">📄</span>
                  <span className="font-medium">{a.filename}</span>
                  <span className="opacity-70 ml-1">
                    {a.sizeBytes > 0 ? ` · ${fmtBytes(a.sizeBytes)}` : ''} · {statusLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="ml-1 opacity-70 hover:opacity-100"
                    aria-label="remove"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {mentions.length > 0 && (
          <div className="px-3 pt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              {t('chatInput.addressedTo')}
            </span>
            {mentions.map((m) => {
              const personaId =
                activeSession?.participants?.find((p) => p.agentId === m)?.personaId ??
                DEFAULT_PERSONA_ID;
              const persona = personas.find((p) => p.id === personaId);
              const personaLabel =
                personaId !== DEFAULT_PERSONA_ID && persona ? ` · ${persona.name}` : '';
              return (
                <button
                  key={m}
                  type="button"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setChipPicker({
                      agentId: m,
                      anchor: { top: rect.bottom + 6, left: rect.left },
                    });
                  }}
                  className="inline-flex items-center text-[12px] rounded-full bg-accent-muted text-accent px-2.5 py-0.5 hover:bg-accent hover:text-white cursor-pointer transition-colors"
                  title={t('chat.changePersona')}
                >
                  <span className="font-medium">@{m}</span>
                  {personaLabel && <span className="opacity-80 ml-1">{personaLabel}</span>}
                </button>
              );
            })}
          </div>
        )}

        {chipPicker && (
          <PersonaPicker
            currentPersonaId={
              activeSession?.participants?.find((p) => p.agentId === chipPicker.agentId)
                ?.personaId ?? DEFAULT_PERSONA_ID
            }
            anchor={chipPicker.anchor}
            onSelect={async (personaId) => {
              await setParticipantPersona(chipPicker.agentId, personaId);
              setChipPicker(null);
            }}
            onClose={() => setChipPicker(null)}
          />
        )}

        <div className="px-3 pt-2 pb-2 flex items-end gap-2 relative">
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={!activeSession?.id}
            title={t('chat.attach')}
            aria-label={t('chat.attach')}
            className="self-end h-7 w-7 flex items-center justify-center text-ink-faint hover:text-accent rounded-[6px] cursor-pointer transition-colors disabled:opacity-30"
          >
            📎
          </button>
          <button
            type="button"
            onClick={handleAttachUrl}
            disabled={!activeSession?.id}
            title={t('chat.attachUrl')}
            aria-label={t('chat.attachUrl')}
            className="self-end h-7 w-7 flex items-center justify-center text-ink-faint hover:text-accent rounded-[6px] cursor-pointer transition-colors disabled:opacity-30"
          >
            🔗
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chatInput.placeholder')}
              rows={1}
              disabled={disabled || streaming}
              className="w-full bg-transparent border-0 p-0 resize-none text-[14px] leading-[1.55] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
              style={{ minHeight: '1.55em' }}
            />
            {showPicker && (
              <MentionPicker
                providers={providers}
                onSelect={handlePickerSelect}
                onClose={() => setShowPicker(false)}
              />
            )}
          </div>

          {streaming ? (
            <button
              onClick={onStop}
              className="self-end h-7 px-3 text-[12px] font-medium text-white bg-danger hover:bg-danger/90 rounded-[6px] cursor-pointer transition-colors"
            >
              {t('chatInput.stop')}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="self-end h-7 px-3 text-[12px] font-medium text-white bg-accent hover:bg-accent-hover rounded-[6px] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              {t('chatInput.send')}
            </button>
          )}
        </div>

        <div className="px-3 pb-2 flex items-center justify-between">
          <span className="text-[10px] tracking-[0.04em] text-ink-faint uppercase">
            {streaming ? t('chatInput.composing') : t('chatInput.shortcut')}
          </span>
          {input.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-ink-faint">
              {input.length.toLocaleString()} {t('chatInput.charSuffix')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /@(\S+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].replace(/[,.\s)]*$/, '');
    if (name) mentions.push(name);
  }
  return [...new Set(mentions)];
}

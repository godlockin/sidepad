import React, { useState, useRef, useEffect } from 'react';
import { MentionPicker } from './MentionPicker';
import { PersonaPicker } from './PersonaPicker';
import { useSessionStore } from '../stores/session-store';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';

interface ChatInputProps {
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  providers?: Array<{ id: string; configId: string }>;
  onMentionSelect?: (providerId: string) => void;
}

export function ChatInput({
  onSend,
  onStop,
  streaming,
  disabled = false,
  providers = [],
  onMentionSelect,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [chipPicker, setChipPicker] = useState<{
    agentId: string;
    anchor: { top: number; left: number };
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    onSend(input.trim(), mentions);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const mentions = extractMentions(input);
  const canSend = !disabled && !streaming && input.trim().length > 0;

  return (
    <div className="px-4 pb-4 pt-2 bg-paper">
      <div className="relative border border-rule rounded-[10px] bg-surface focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-colors">
        {/* Mention chips */}
        {mentions.length > 0 && (
          <div className="px-3 pt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              addressed to
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
                  title="Click to change persona"
                >
                  <span className="font-medium">@{m}</span>
                  {personaLabel && (
                    <span className="opacity-80 ml-1">{personaLabel}</span>
                  )}
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
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message… use @ to address a voice"
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
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="self-end h-7 px-3 text-[12px] font-medium text-white bg-accent hover:bg-accent-hover rounded-[6px] cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              Send
            </button>
          )}
        </div>

        <div className="px-3 pb-2 flex items-center justify-between">
          <span className="text-[10px] tracking-[0.04em] text-ink-faint uppercase">
            {streaming ? 'composing reply…' : '⌘ + ↵ to send · @ to address'}
          </span>
          {input.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-ink-faint">
              {input.length.toLocaleString()} ch
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

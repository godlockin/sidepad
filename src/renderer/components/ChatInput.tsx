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

/**
 * Editorial composer.
 *
 * No card. No heavy border. Just a hairline above, a Fraunces-set textarea
 * that blends into the paper, and a monospace "send ↵" at the margin.
 */
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
    <div className="relative border-t border-rule bg-paper">
      {/* Mention chips — italic inline tags, clickable to switch persona */}
      {mentions.length > 0 && (
        <div className="px-6 pt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-xxs uppercase tracking-[0.16em] text-ink-faint">
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
                className="font-display italic text-[13px] text-accent hover:underline decoration-accent/40 underline-offset-[3px] cursor-pointer"
                style={{ fontVariationSettings: "'opsz' 14, 'SOFT' 50, 'WONK' 0" }}
                title="Click to change persona"
              >
                @{m}
                {personaLabel && (
                  <span className="font-mono not-italic text-[10px] uppercase tracking-[0.14em] text-ink-faint ml-1">
                    {personaLabel}
                  </span>
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

      <div className="px-6 py-4 flex items-end gap-5 relative">
        {/* Left eyebrow marker */}
        <span
          aria-hidden
          className="font-mono text-xxs uppercase tracking-[0.18em] text-ink-faint pb-[10px] select-none"
        >
          write
        </span>

        {/* Textarea — blends into paper */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="A message, a question, a thought…"
            rows={1}
            disabled={disabled || streaming}
            className="w-full bg-transparent border-0 p-0 resize-none font-serif-body text-[15.5px] leading-[1.6] text-ink placeholder:text-ink-faint placeholder:italic focus:outline-none disabled:opacity-50"
            style={{ minHeight: '1.6em' }}
          />
          {showPicker && (
            <MentionPicker
              providers={providers}
              onSelect={handlePickerSelect}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>

        {/* Action — monospace marginalia */}
        {streaming ? (
          <button
            onClick={onStop}
            className="self-end pb-[10px] font-mono text-xxs uppercase tracking-[0.16em] text-danger hover:text-danger cursor-pointer transition-colors"
          >
            stop ■
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="self-end pb-[10px] font-mono text-xxs uppercase tracking-[0.16em] text-ink-faint hover:text-accent cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:text-ink-faint"
          >
            send ↵
          </button>
        )}
      </div>

      {/* Keyboard hint — barely there */}
      <div className="px-6 pb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.14em] text-ink-faint/70 uppercase">
          {streaming ? 'composing reply…' : '⌘ + ↵ to send · @ to address'}
        </span>
        {input.length > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-ink-faint/70">
            {input.length.toLocaleString()} ch
          </span>
        )}
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

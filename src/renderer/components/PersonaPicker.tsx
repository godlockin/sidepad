import React, { useEffect, useRef, useState } from 'react';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';

interface PersonaPickerProps {
  currentPersonaId: string | null;
  onSelect: (personaId: string) => void;
  onClose: () => void;
  /**
   * Optional: position via fixed coords (top, left) anchored to a chip.
   * Defaults to absolute positioned above the trigger.
   */
  anchor?: { top: number; left: number } | null;
  onEditLibrary?: () => void;
}

/**
 * Floating editorial list — paper, hairlines, italic display face.
 * Mirrors MentionPicker visually so the language stays consistent.
 */
export function PersonaPicker({
  currentPersonaId,
  onSelect,
  onClose,
  anchor,
  onEditLibrary,
}: PersonaPickerProps) {
  const personas = usePersonaStore((s) => s.personas);
  const loadPersonas = usePersonaStore((s) => s.loadPersonas);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = personas.findIndex((p) => p.id === currentPersonaId);
    return idx >= 0 ? idx : 0;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (personas.length === 0) loadPersonas();
  }, [personas.length, loadPersonas]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, personas.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const p = personas[selectedIndex];
        if (p) onSelect(p.id);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [personas, selectedIndex, onSelect, onClose]);

  // Outside-click dismiss
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    };
    // defer to next tick so the opening click doesn't immediately close
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const positionStyle: React.CSSProperties = anchor
    ? { position: 'fixed', top: anchor.top, left: anchor.left, zIndex: 50 }
    : {};

  const className = anchor
    ? 'min-w-[260px] bg-paper border border-rule-strong shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up'
    : 'absolute bottom-full left-0 mb-3 min-w-[260px] bg-paper border border-rule-strong shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)] anim-fade-up z-40';

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Choose a persona"
      style={positionStyle}
      className={className}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between">
        <span className="font-mono text-xxs uppercase tracking-[0.18em] text-ink-faint">
          choose a persona
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint/70 uppercase">
          ↑↓ ↵
        </span>
      </div>
      <hr className="border-0 border-t border-rule mx-4" />

      <ol className="py-1 max-h-[280px] overflow-y-auto">
        {personas.length === 0 && (
          <li className="px-4 py-3 font-serif-body italic text-[13px] text-ink-faint">
            No personas yet.
          </li>
        )}
        {personas.map((p, i) => {
          const active = i === selectedIndex;
          const current = p.id === currentPersonaId;
          return (
            <li key={p.id}>
              <button
                role="option"
                aria-selected={active}
                onClick={() => onSelect(p.id)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`relative w-full text-left px-4 py-2 flex items-baseline gap-3 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active ? 'bg-ink/[0.035]' : 'hover:bg-ink/[0.02]'
                }`}
              >
                <span
                  className={`font-mono text-xxs tabular-nums ${
                    active ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 min-w-0 flex items-baseline gap-2">
                  <span
                    className={`font-display italic text-[15px] truncate ${
                      active ? 'text-ink' : 'text-ink-muted'
                    }`}
                    style={{ fontVariationSettings: "'opsz' 24, 'SOFT' 50, 'WONK' 0" }}
                  >
                    {p.name}
                  </span>
                  {p.id === DEFAULT_PERSONA_ID && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                      · default
                    </span>
                  )}
                </span>
                {current && (
                  <span aria-hidden className="font-mono text-xxs text-accent">
                    ·
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {onEditLibrary && (
        <>
          <hr className="border-0 border-t border-rule mx-4" />
          <button
            onClick={onEditLibrary}
            className="w-full px-4 py-2 text-left font-mono text-xxs uppercase tracking-[0.16em] text-ink-faint hover:text-accent cursor-pointer transition-colors"
          >
            edit personas…
          </button>
        </>
      )}
    </div>
  );
}

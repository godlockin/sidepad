import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePersonaStore, DEFAULT_PERSONA_ID } from '../stores/persona-store';

interface PersonaPickerProps {
  currentPersonaId: string | null;
  onSelect: (personaId: string) => void;
  onClose: () => void;
  anchor?: { top: number; left: number } | null;
  onEditLibrary?: () => void;
}

export function PersonaPicker({
  currentPersonaId,
  onSelect,
  onClose,
  anchor,
  onEditLibrary,
}: PersonaPickerProps) {
  const { t } = useTranslation();
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

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    };
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
    ? 'min-w-[240px] bg-surface border border-rule rounded-[8px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up'
    : 'absolute bottom-full left-0 mb-2 min-w-[240px] bg-surface border border-rule rounded-[8px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up z-40';

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('personaPicker.title')}
      style={positionStyle}
      className={className}
    >
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          {t('personaPicker.title')}
        </span>
        <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint uppercase">
          ↑↓ ↵
        </span>
      </div>
      <hr className="border-0 border-t border-rule" />

      <ol className="py-1 max-h-[280px] overflow-y-auto">
        {personas.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-ink-faint">{t('personaPicker.empty')}</li>
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
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active ? 'bg-accent-muted' : 'hover:bg-ink/[0.03]'
                }`}
              >
                <span
                  className={`flex-1 text-[13px] truncate ${
                    active ? 'text-accent font-medium' : 'text-ink'
                  }`}
                >
                  {p.name}
                </span>
                {p.id === DEFAULT_PERSONA_ID && (
                  <span className="text-[10px] uppercase tracking-[0.04em] text-ink-faint">
                    {t('personaPicker.default')}
                  </span>
                )}
                {current && <span className="text-accent text-[12px]">✓</span>}
              </button>
            </li>
          );
        })}
      </ol>

      {onEditLibrary && (
        <>
          <hr className="border-0 border-t border-rule" />
          <button
            onClick={onEditLibrary}
            className="w-full px-3 py-2 text-left text-[12px] font-medium text-ink-muted hover:text-accent cursor-pointer transition-colors"
          >
            {t('personaPicker.editLibrary')}
          </button>
        </>
      )}
    </div>
  );
}

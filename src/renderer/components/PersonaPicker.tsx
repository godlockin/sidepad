import React, { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
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

  useEffect(() => {
    if (personas.length === 0) loadPersonas();
  }, [personas.length, loadPersonas]);

  // Keyboard navigation
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
      }
      // Escape is handled by Radix Popover automatically
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [personas, selectedIndex, onSelect]);

  const listboxId = 'persona-picker-listbox';
  const activeOptionId = personas[selectedIndex]
    ? `persona-option-${personas[selectedIndex].id}`
    : undefined;

  const content = (
    <div
      role="listbox"
      id={listboxId}
      aria-label={t('personaPicker.title')}
      aria-activedescendant={activeOptionId}
      className="min-w-[240px] bg-surface border border-rule rounded-[8px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up"
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
            <li key={p.id} role="presentation">
              <button
                id={`persona-option-${p.id}`}
                role="option"
                aria-selected={active}
                aria-current={current ? 'true' : undefined}
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
                {current && <span className="text-accent text-[12px]" aria-label={t('personaPicker.selected')}>✓</span>}
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

  // When anchor is provided, use Radix Popover with a virtual anchor element
  // so Radix handles: Escape close, outside-click close, focus trap, portal
  if (anchor) {
    return (
      <Popover.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
        {/* Virtual anchor: a zero-size fixed element at the computed position */}
        <Popover.Anchor
          style={{
            position: 'fixed',
            top: anchor.top,
            left: anchor.left,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={0}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-50"
          >
            {content}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  // Fallback: inline absolute positioning (same as before, no anchor)
  return (
    <Popover.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Popover.Anchor asChild>
        <span style={{ position: 'absolute', bottom: '100%', left: 0 }} />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-40"
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

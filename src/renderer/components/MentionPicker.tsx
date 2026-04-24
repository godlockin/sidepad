import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface MentionPickerProps {
  providers: Array<{ id: string; configId: string }>;
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

export function MentionPicker({ providers, onSelect, onClose }: MentionPickerProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, providers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (providers[selectedIndex]) {
          onSelect(providers[selectedIndex].id);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, providers, onSelect, onClose]);

  if (providers.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('mentionPicker.title')}
      className="absolute bottom-full left-0 mb-2 min-w-[240px] bg-surface border border-rule rounded-[8px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up z-40"
    >
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          {t('mentionPicker.title')}
        </span>
        <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint uppercase">
          ↑↓ ↵
        </span>
      </div>
      <hr className="border-0 border-t border-rule" />

      <ol className="py-1">
        {providers.map((p, i) => {
          const active = i === selectedIndex;
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
                <span className={`text-[13px] font-medium ${active ? 'text-accent' : 'text-ink'}`}>
                  @{p.id}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-faint truncate">
                  {p.configId}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface MentionItem {
  /** The id inserted into the text after "@". May be composite ("provider::persona"). */
  id: string;
  label: string;
  hint?: string;
  /** i18n group title; consecutive items sharing a group get one header. */
  group?: string;
}

interface MentionPickerProps {
  items: MentionItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function MentionPicker({ items, onSelect, onClose }: MentionPickerProps) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex].id);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, items, onSelect, onClose]);

  if (items.length === 0) return null;

  const activeOptionId = items[selectedIndex]
    ? `mention-option-${items[selectedIndex].id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : undefined;

  let lastGroup: string | undefined;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('mentionPicker.title')}
      aria-activedescendant={activeOptionId}
      className="absolute bottom-full left-0 mb-2 min-w-[240px] max-h-[280px] overflow-y-auto bg-surface border border-rule rounded-[8px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] anim-fade-up z-40"
    >
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between sticky top-0 bg-surface z-10">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          {t('mentionPicker.title')}
        </span>
        <span className="font-mono text-[10px] tracking-[0.04em] text-ink-faint uppercase">
          ↑↓ ↵
        </span>
      </div>
      <hr className="border-0 border-t border-rule" />

      <ol className="py-1">
        {items.map((item, i) => {
          const active = i === selectedIndex;
          const showHeader = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <React.Fragment key={item.id}>
              {showHeader && item.group && (
                <li
                  aria-hidden="true"
                  className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint"
                >
                  {item.group}
                </li>
              )}
              <li role="presentation">
                <button
                  id={`mention-option-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(item.id)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                    active ? 'bg-accent-muted' : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  <span className={`text-[13px] font-medium ${active ? 'text-accent' : 'text-ink'}`}>
                    @{item.label}
                  </span>
                  {item.hint && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-ink-faint truncate">
                      {item.hint}
                    </span>
                  )}
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </div>
  );
}

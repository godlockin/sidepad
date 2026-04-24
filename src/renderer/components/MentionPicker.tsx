import React, { useRef, useEffect, useState } from 'react';

interface MentionPickerProps {
  providers: Array<{ id: string; configId: string }>;
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

/**
 * Floating editorial list — no card, just paper + hairlines.
 * Appears above the composer when `@` is typed.
 */
export function MentionPicker({ providers, onSelect, onClose }: MentionPickerProps) {
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
      aria-label="Address a voice"
      className="absolute bottom-full left-0 mb-3 min-w-[260px] bg-paper border border-rule-strong shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)] anim-fade-up"
    >
      {/* Eyebrow head */}
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between">
        <span className="font-mono text-xxs uppercase tracking-[0.18em] text-ink-faint">
          address a voice
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint/70 uppercase">
          ↑↓ ↵
        </span>
      </div>
      <hr className="border-0 border-t border-rule mx-4" />

      {/* Options */}
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
                className={`relative w-full text-left px-4 py-2 flex items-baseline gap-3 cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                  active ? 'bg-ink/[0.035]' : 'hover:bg-ink/[0.02]'
                }`}
              >
                {/* Gutter marker */}
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
                    @{p.id}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint truncate">
                    {p.configId}
                  </span>
                </span>
                {active && (
                  <span
                    aria-hidden
                    className="font-mono text-xxs text-accent"
                  >
                    ↵
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

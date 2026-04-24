import React, { useEffect, useState } from 'react';
import type { Message } from '../../main/store/types';
import { Eyebrow, Rule, Button, Input } from './ui';

interface EditForkModalProps {
  message: Message;
  onEditInPlace: (newContent: string) => void;
  onFork: (newContent: string, title?: string) => void;
  onClose: () => void;
}

/**
 * Editorial overlay. No card chrome — a sheet of paper laid over the room.
 * Two intentions:
 *   · Revise here (mutate this entry, discard what followed)
 *   · Branch off (keep this page, start a new one from this point)
 */
export function EditForkModal({
  message,
  onEditInPlace,
  onFork,
  onClose,
}: EditForkModalProps) {
  const [content, setContent] = useState(message.content);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'edit' | 'fork' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title_ =
    mode === 'edit'
      ? 'Revise in place.'
      : mode === 'fork'
      ? 'Branch into a new page.'
      : 'How shall we amend?';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[2px] anim-fade-up"
      onClick={onClose}
    >
      <div
        className="relative w-[620px] max-h-[82vh] flex flex-col bg-paper border border-rule-strong shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corner folio */}
        <span
          aria-hidden
          className="absolute top-3 left-4 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint"
        >
          — folio —
        </span>

        {/* Close, as typographic × in the corner */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-4 font-mono text-sm text-ink-faint hover:text-accent cursor-pointer transition-colors"
        >
          ×
        </button>

        <header className="px-10 pt-10 pb-5">
          <Eyebrow>
            {mode === 'fork' ? 'branch' : mode === 'edit' ? 'revise' : 'amend'}
          </Eyebrow>
          <h3
            className="mt-2 font-display text-[28px] leading-[1.1] tracking-tighter text-ink"
            style={{
              fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'WONK' 1",
              fontStyle: 'italic',
            }}
          >
            {title_}
          </h3>
          {!mode && (
            <p className="mt-3 font-serif-body text-[14px] leading-[1.65] text-ink-muted max-w-[52ch]">
              Revise replaces this entry and{' '}
              <span className="italic">discards everything that followed</span>.
              Branching keeps the page whole and opens a new one from this
              point.
            </p>
          )}
        </header>

        <Rule />

        <div className="flex-1 overflow-y-auto px-10 py-6">
          <Eyebrow>the text</Eyebrow>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            autoFocus
            className="mt-3 w-full bg-transparent border-0 border-b border-rule p-0 py-2 resize-none font-serif-body text-[15.5px] leading-[1.65] text-ink placeholder:italic placeholder:text-ink-faint focus:outline-none focus:border-ink transition-colors duration-[var(--dur-fast)]"
          />

          {mode === 'fork' && (
            <div className="mt-6">
              <Eyebrow>title for the new page</Eyebrow>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="optional — untitled, if left blank"
                className="mt-2"
              />
            </div>
          )}
        </div>

        <Rule />

        <footer className="px-10 py-5 flex items-center justify-between">
          {!mode ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                never mind
              </Button>
              <div className="flex items-center gap-5">
                <Button variant="link" size="sm" onClick={() => setMode('fork')}>
                  branch off ↳
                </Button>
                <Button variant="primary" size="sm" onClick={() => setMode('edit')}>
                  revise here
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
                ← back
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (mode === 'edit') onEditInPlace(content);
                  else onFork(content, title || undefined);
                }}
              >
                {mode === 'edit' ? 'apply revision' : 'open new page ↳'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

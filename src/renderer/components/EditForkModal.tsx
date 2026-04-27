import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/types';
import { Button, Input } from './ui';

interface EditForkModalProps {
  message: Message;
  onEditInPlace: (newContent: string) => void;
  onFork: (newContent: string, title?: string) => void;
  onClose: () => void;
}

export function EditForkModal({
  message,
  onEditInPlace,
  onFork,
  onClose,
}: EditForkModalProps) {
  const { t } = useTranslation();
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

  const heading =
    mode === 'edit'
      ? t('editFork.headingEdit')
      : mode === 'fork'
      ? t('editFork.headingFork')
      : t('editFork.headingChoose');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[2px] anim-fade-up"
      onClick={onClose}
    >
      <div
        className="relative w-[600px] max-h-[82vh] flex flex-col bg-surface border border-rule rounded-[10px] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('editFork.close')}
          className="absolute top-3 right-3 w-7 h-7 rounded-[6px] flex items-center justify-center text-ink-faint hover:bg-ink/[0.06] hover:text-ink cursor-pointer transition-colors"
        >
          ×
        </button>

        <header className="px-6 pt-6 pb-4">
          <h3 className="text-[18px] font-semibold text-ink">{heading}</h3>
          {!mode && (
            <p className="mt-2 text-[13px] leading-[1.55] text-ink-muted">
              {t('editFork.explainer')}
            </p>
          )}
        </header>

        <hr className="border-0 border-t border-rule" />

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
            {t('editFork.contentLabel')}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            autoFocus
            className="mt-1.5 w-full bg-surface border border-rule rounded-[6px] px-3 py-2 resize-none text-[13px] leading-[1.55] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
          />

          {mode === 'fork' && (
            <div className="mt-4">
              <label className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
                {t('editFork.titleLabel')}
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('editFork.titlePlaceholder')}
                className="mt-1.5"
              />
            </div>
          )}
        </div>

        <hr className="border-0 border-t border-rule" />

        <footer className="px-6 py-3 flex items-center justify-between">
          {!mode ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('editFork.cancel')}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setMode('fork')}>
                  {t('editFork.branch')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => setMode('edit')}>
                  {t('editFork.revise')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
                {t('editFork.back')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (mode === 'edit') onEditInPlace(content);
                  else onFork(content, title || undefined);
                }}
              >
                {mode === 'edit' ? t('editFork.applyRevision') : t('editFork.openNew')}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

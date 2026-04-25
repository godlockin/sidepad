import React, { useRef, useState } from 'react';
import { Avatar } from './Avatar';

export interface IconEditorProps {
  name: string;
  kind: 'emoji' | 'image' | null;
  value: string | null;
  anchor: { top: number; left: number };
  onSave: (kind: 'emoji' | 'image' | null, value: string | null) => void | Promise<void>;
  onClose: () => void;
}

const PRESET_EMOJI = [
  '💬','✦','★','◆','◉','▲','●','■',
  '🤖','🧠','💡','📝','📚','🔮','🛠️','⚙️',
  '🦊','🐱','🐼','🦉','🐝','🌱','🌊','🔥',
  '☕','🎯','🎨','🚀','📌','🧩','🪄','🌟',
];

async function fileToDataURL(file: File, maxDim = 128): Promise<string> {
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    // Prefer webp for compactness, fallback to png
    let out = canvas.toDataURL('image/webp', 0.85);
    if (!out.startsWith('data:image/webp')) {
      out = canvas.toDataURL('image/png');
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function IconEditor({ name, kind, value, anchor, onSave, onClose }: IconEditorProps) {
  const [emojiInput, setEmojiInput] = useState(kind === 'emoji' ? value ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickEmoji = async (e: string) => {
    setBusy(true);
    try {
      await onSave('emoji', e);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setErr(null);
    if (file.size > 4 * 1024 * 1024) {
      setErr('Image must be ≤ 4 MB');
      return;
    }
    setBusy(true);
    try {
      const data = await fileToDataURL(file);
      await onSave('image', data);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await onSave(null, null);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-surface border border-rule rounded-[8px] shadow-lg p-3 w-[280px]"
        style={{ top: anchor.top, left: anchor.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preview */}
        <div className="flex items-center gap-3 mb-3 pb-3 border-b border-rule">
          <Avatar kind={kind} value={value} name={name} size={36} rounded="md" />
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] text-ink-faint uppercase tracking-wider">Icon</span>
            <span className="text-[13px] text-ink truncate">{name || '—'}</span>
          </div>
        </div>

        {/* Emoji presets */}
        <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">Emoji</div>
        <div className="grid grid-cols-8 gap-1 mb-2">
          {PRESET_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              disabled={busy}
              onClick={() => pickEmoji(e)}
              className="h-7 rounded hover:bg-surface-2 cursor-pointer text-[16px] leading-none flex items-center justify-center"
            >
              {e}
            </button>
          ))}
        </div>

        {/* Custom emoji entry */}
        <div className="flex items-center gap-2 mb-3">
          <input
            value={emojiInput}
            onChange={(e) => setEmojiInput(e.target.value.slice(0, 4))}
            placeholder="Custom…"
            className="flex-1 bg-surface-2 border border-rule rounded px-2 py-1 text-[13px] text-ink focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!emojiInput || busy}
            onClick={() => emojiInput && pickEmoji(emojiInput)}
            className="text-[12px] font-medium text-accent hover:underline disabled:text-ink-faint disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
          >
            Use
          </button>
        </div>

        {/* Image upload */}
        <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">Image</div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="w-full text-[12px] py-1.5 bg-surface-2 border border-rule rounded hover:border-accent hover:text-accent cursor-pointer transition-colors mb-2"
        >
          Upload image…
        </button>
        {err && <div className="text-[11px] text-danger mb-2">{err}</div>}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-rule">
          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="text-[11px] text-ink-faint hover:text-danger cursor-pointer"
          >
            Reset to auto
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-ink-muted hover:text-ink cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}

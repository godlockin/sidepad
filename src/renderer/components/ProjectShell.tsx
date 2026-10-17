import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../lib/trpc-client';

interface ShellLine {
  id: string;
  kind: 'in' | 'out' | 'err';
  text: string;
}

export function ProjectShell({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ShellLine[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const run = async () => {
    const command = cmd.trim();
    if (!command || busy) return;
    setBusy(true);
    setLines((prev) => [...prev, { id: `${Date.now()}-in`, kind: 'in', text: `$ ${command}` }]);
    setCmd('');
    try {
      const res = await trpc.pty.run.mutate({ sessionId, command });
      if (!res.ok) {
        setLines((prev) => [
          ...prev,
          { id: `${Date.now()}-err`, kind: 'err', text: res.error },
        ]);
      } else {
        const header = res.timedOut
          ? t('chat.shell.timedOut')
          : t('chat.shell.exit', { code: res.exitCode ?? '?' });
        setLines((prev) => [
          ...prev,
          { id: `${Date.now()}-meta`, kind: 'out', text: header },
          ...(res.output
            ? [{ id: `${Date.now()}-out`, kind: 'out' as const, text: res.output }]
            : []),
        ]);
      }
    } catch (e) {
      setLines((prev) => [
        ...prev,
        {
          id: `${Date.now()}-err`,
          kind: 'err',
          text: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-rule bg-surface-2">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rule">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('chat.shell.title')}
        </span>
        <span className="text-[11px] text-ink-muted truncate">{t('chat.shell.hint')}</span>
        {lines.length > 0 && (
          <button
            type="button"
            onClick={() => setLines([])}
            className="ml-auto text-[11px] text-ink-muted hover:text-ink cursor-pointer"
          >
            {t('chat.shell.clear')}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 font-mono text-[12px] space-y-1">
        {lines.length === 0 && (
          <p className="text-ink-faint">{t('chat.shell.empty')}</p>
        )}
        {lines.map((line) => (
          <pre
            key={line.id}
            className={`whitespace-pre-wrap break-all ${
              line.kind === 'in'
                ? 'text-accent'
                : line.kind === 'err'
                ? 'text-danger'
                : 'text-ink'
            }`}
          >
            {line.text}
          </pre>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        className="flex gap-2 px-3 py-2 border-t border-rule"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <span className="text-[12px] font-mono text-accent self-center">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          disabled={busy}
          placeholder={t('chat.shell.placeholder')}
          className="flex-1 bg-paper border border-rule rounded-[6px] px-2 py-1.5 text-[12px] font-mono text-ink focus:border-accent focus:outline-none disabled:opacity-50"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || !cmd.trim()}
          className="px-2.5 py-1 rounded-[6px] text-[12px] bg-accent text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
        >
          {busy ? '…' : t('chat.shell.run')}
        </button>
      </form>
    </div>
  );
}

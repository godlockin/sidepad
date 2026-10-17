import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getPtyApi } from '../lib/pty-api';
import { trpc } from '../lib/trpc-client';

interface ShellLine {
  id: string;
  kind: 'in' | 'out' | 'err';
  text: string;
}

/**
 * Project-linked shell panel.
 * Prefers interactive node-pty + xterm; falls back to one-shot pty.run when preload PTY is unavailable.
 */
export function ProjectShell({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const pty = getPtyApi();
  if (pty) {
    return <InteractiveShell sessionId={sessionId} />;
  }
  return <LegacyShell sessionId={sessionId} />;
}

function InteractiveShell({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'dead' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const api = getPtyApi();
    const host = hostRef.current;
    if (!api || !host) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1a1b1e',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6',
      },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }

    const id = `shell-${sessionId}-${Date.now()}`;
    let unsubData: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;
    let alive = true;

    const start = async () => {
      const dims = { cols: term.cols, rows: term.rows };
      const res = await api.spawn({
        id,
        chatSessionId: sessionId,
        cols: dims.cols,
        rows: dims.rows,
      });
      if (!alive) {
        if (res.ok) void api.kill(id);
        return;
      }
      if (!res.ok) {
        setStatus('error');
        setError(res.error ?? t('chat.shell.startFailed'));
        return;
      }
      setStatus('ready');
      setError(null);
      unsubData = api.onData(id, (data) => term.write(data));
      unsubExit = api.onExit(id, () => {
        setStatus('dead');
        term.writeln(`\r\n[${t('chat.shell.exited')}]`);
      });
      term.onData((data) => api.write(id, data));
      term.focus();
    };

    void start();

    const onResize = () => {
      try {
        fit.fit();
        api.resize(id, term.cols, term.rows);
      } catch {
        /* ignore */
      }
    };
    const ro = new ResizeObserver(() => onResize());
    ro.observe(host);
    window.addEventListener('resize', onResize);

    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      unsubData?.();
      unsubExit?.();
      void api.kill(id);
      term.dispose();
    };
  }, [sessionId, t]);

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-rule bg-[#1a1b1e]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-rule bg-surface-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('chat.shell.title')}
        </span>
        <span className="text-[11px] text-ink-muted truncate">{t('chat.shell.liveHint')}</span>
        <span
          className={`ml-auto text-[10px] uppercase tracking-wider ${
            status === 'ready'
              ? 'text-success'
              : status === 'error' || status === 'dead'
              ? 'text-danger'
              : 'text-ink-faint'
          }`}
        >
          {status === 'starting'
            ? t('chat.shell.starting')
            : status === 'ready'
            ? t('chat.shell.ready')
            : status === 'dead'
            ? t('chat.shell.exited')
            : t('chat.shell.error')}
        </span>
      </div>
      {error && <p className="px-3 py-2 text-[12px] text-danger bg-surface">{error}</p>}
      <div ref={hostRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  );
}

function LegacyShell({ sessionId }: { sessionId: string }) {
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
        setLines((prev) => [...prev, { id: `${Date.now()}-err`, kind: 'err', text: res.error }]);
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
        {lines.length === 0 && <p className="text-ink-faint">{t('chat.shell.empty')}</p>}
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

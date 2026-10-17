import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { trpc } from '../../lib/trpc-client';

type AuditRow = Awaited<ReturnType<typeof trpc.audit.list.query>>[number];

function downloadText(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await trpc.audit.list.query({ limit: 80 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportMd = async () => {
    const md = await trpc.audit.exportMarkdown.query({ limit: 200 });
    const ymd = new Date().toISOString().slice(0, 10);
    downloadText(md, `sidepad-audit-log-${ymd}.md`, 'text/markdown');
  };

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('settings.audit.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted mb-4">{t('settings.audit.body')}</p>
      <div className="flex gap-2 mb-4">
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          {t('settings.audit.refresh')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void exportMd()}>
          {t('settings.audit.export')}
        </Button>
      </div>
      {error && <p className="text-[13px] text-danger mb-3">{error}</p>}
      {loading && rows.length === 0 ? (
        <p className="text-[13px] text-ink-faint">{t('settings.audit.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-ink-faint">{t('settings.audit.empty')}</p>
      ) : (
        <ul className="border border-rule rounded-[10px] bg-surface divide-y divide-rule overflow-hidden">
          {rows.map((ev) => (
            <li key={ev.id} className="px-4 py-3">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="font-mono text-accent">{ev.kind}</span>
                <span className="text-ink-faint tabular-nums">
                  {new Date(ev.createdAt * 1000).toLocaleString()}
                </span>
              </div>
              <p className="text-[13px] text-ink mt-1 leading-[1.4]">{ev.summary}</p>
              {ev.sessionId && (
                <p className="text-[11px] text-ink-faint font-mono mt-1 truncate">{ev.sessionId}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

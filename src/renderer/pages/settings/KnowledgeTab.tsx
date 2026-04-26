import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { trpc } from '../../lib/trpc-client';

interface DocRow {
  id: string;
  source_type: string;
  source_path: string;
  filename: string | null;
  status: 'pending' | 'indexing' | 'ready' | 'error';
  error: string | null;
  chunk_count: number;
  token_count: number;
  updated_at: number;
}

interface EmbedderCfg {
  provider: 'ollama' | 'openai';
  model: string;
  baseUrl: string;
  apiKeySet: boolean;
}

interface ProgressMap {
  [docId: string]: { phase: string; current: number; total: number };
}

interface SearchHit {
  documentId: string;
  chunkId: string;
  text: string;
  score: number;
  filename: string | null;
}

export function KnowledgeTab() {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [cfg, setCfg] = useState<EmbedderCfg | null>(null);
  const [draftCfg, setDraftCfg] = useState<{
    provider: 'ollama' | 'openai';
    model: string;
    baseUrl: string;
    apiKey: string;
  }>({ provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434', apiKey: '' });
  const [savingCfg, setSavingCfg] = useState(false);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const refreshDocs = useCallback(async () => {
    const rows = (await trpc.knowledge.list.query()) as DocRow[];
    setDocs(rows);
  }, []);

  const refreshCfg = useCallback(async () => {
    const c = (await trpc.knowledge.getEmbedderConfig.query()) as EmbedderCfg;
    setCfg(c);
    setDraftCfg((d) => ({
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl,
      apiKey: d.apiKey,
    }));
  }, []);

  useEffect(() => {
    void refreshDocs();
    void refreshCfg();
    const t = setInterval(() => void refreshDocs(), 2000);
    return () => clearInterval(t);
  }, [refreshDocs, refreshCfg]);

  // Subscribe to progress for any non-terminal docs.
  useEffect(() => {
    const subs: Array<{ unsubscribe?: () => void } | null> = [];
    for (const d of docs) {
      if (d.status === 'pending' || d.status === 'indexing') {
        const sub = (trpc as any).knowledge.onProgress.subscribe(
          { documentId: d.id },
          {
            onData: (p: { phase: string; current: number; total: number }) => {
              setProgress((m) => ({ ...m, [d.id]: p }));
            },
            onError: () => {},
          },
        );
        subs.push(sub);
      }
    }
    return () => {
      for (const s of subs) {
        try { s?.unsubscribe?.(); } catch { /* ignore */ }
      }
    };
  }, [docs]);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      await trpc.knowledge.setEmbedderConfig.mutate({
        provider: draftCfg.provider,
        model: draftCfg.model,
        baseUrl: draftCfg.baseUrl,
        ...(draftCfg.apiKey ? { apiKey: draftCfg.apiKey } : {}),
      });
      setDraftCfg((d) => ({ ...d, apiKey: '' }));
      await refreshCfg();
    } finally {
      setSavingCfg(false);
    }
  };

  const addFile = async () => {
    const res = (await trpc.knowledge.pickFile.mutate()) as { path: string | null };
    if (!res.path) return;
    await trpc.knowledge.add.mutate({ sourceType: 'file', sourcePath: res.path });
    await refreshDocs();
  };

  const addFolder = async () => {
    const res = (await trpc.knowledge.pickFolder.mutate()) as { path: string | null };
    if (!res.path) return;
    await trpc.knowledge.add.mutate({ sourceType: 'folder', sourcePath: res.path });
    await refreshDocs();
  };

  const deleteDoc = async (id: string) => {
    await trpc.knowledge.delete.mutate({ id });
    await refreshDocs();
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = (await trpc.knowledge.search.mutate({ query, k: 5 })) as SearchHit[];
      setHits(r);
    } finally {
      setSearching(false);
    }
  };

  return (
    <section>
      <Heading level={1} className="mb-2">{t('settings.tabs.knowledge')}</Heading>

      {/* Embedder section */}
      <div className="mt-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.knowledge.embedder')}
        </span>
        <div className="mt-3 border border-rule rounded-[10px] bg-surface p-4 space-y-3">
          <div className="flex gap-2 items-center">
            <label className="text-[12px] text-ink-muted w-24">Provider</label>
            <select
              value={draftCfg.provider}
              onChange={(e) =>
                setDraftCfg((d) => ({ ...d, provider: e.target.value as 'ollama' | 'openai' }))
              }
              className="rounded-[6px] border border-rule bg-paper px-2 py-1 text-[13px] text-ink"
            >
              <option value="ollama">ollama</option>
              <option value="openai">openai</option>
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[12px] text-ink-muted w-24">Model</label>
            <input
              value={draftCfg.model}
              onChange={(e) => setDraftCfg((d) => ({ ...d, model: e.target.value }))}
              className="flex-1 rounded-[6px] border border-rule bg-paper px-2 py-1 text-[13px] font-mono text-ink"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[12px] text-ink-muted w-24">Base URL</label>
            <input
              value={draftCfg.baseUrl}
              onChange={(e) => setDraftCfg((d) => ({ ...d, baseUrl: e.target.value }))}
              className="flex-1 rounded-[6px] border border-rule bg-paper px-2 py-1 text-[13px] font-mono text-ink"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[12px] text-ink-muted w-24">API Key</label>
            <input
              type="password"
              autoComplete="off"
              placeholder={cfg?.apiKeySet ? '••••••••' : ''}
              value={draftCfg.apiKey}
              onChange={(e) => setDraftCfg((d) => ({ ...d, apiKey: e.target.value }))}
              className="flex-1 rounded-[6px] border border-rule bg-paper px-2 py-1 text-[13px] font-mono text-ink"
            />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={saveCfg} disabled={savingCfg}>
              {savingCfg ? '…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Documents section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            {t('settings.knowledge.documents')} · {docs.length.toString().padStart(2, '0')}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={addFile}>
              {t('settings.knowledge.addFile')}
            </Button>
            <Button variant="ghost" size="sm" onClick={addFolder}>
              {t('settings.knowledge.addFolder')}
            </Button>
          </div>
        </div>
        <div className="border border-rule rounded-[10px] bg-surface overflow-hidden">
          {docs.length === 0 && (
            <p className="text-[13px] text-ink-faint py-10 text-center">— empty —</p>
          )}
          {docs.length > 0 && (
            <ol className="divide-y divide-rule">
              {docs.map((d) => {
                const p = progress[d.id];
                return (
                  <li key={d.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink truncate">{d.filename || d.source_path}</div>
                      <div className="text-[11px] text-ink-muted">
                        {d.status === 'ready' &&
                          t('settings.knowledge.ready', { chunks: d.chunk_count })}
                        {(d.status === 'pending' || d.status === 'indexing') &&
                          (p
                            ? t('settings.knowledge.indexing', {
                                phase: p.phase,
                                current: p.current,
                                total: p.total,
                              })
                            : d.status)}
                        {d.status === 'error' && (
                          <span className="text-error">
                            {t('settings.knowledge.error')}: {d.error}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => deleteDoc(d.id)}>
                      ×
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {/* Search section */}
      <div className="mt-8">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.knowledge.search')}
        </span>
        <div className="mt-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder={t('settings.knowledge.searchPlaceholder') as string}
            className="flex-1 rounded-[6px] border border-rule bg-paper px-2 py-1.5 text-[13px] text-ink"
          />
          <Button variant="ghost" size="sm" onClick={runSearch} disabled={searching}>
            {searching ? '…' : 'Go'}
          </Button>
        </div>
        {hits && (
          <ol className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden divide-y divide-rule">
            {hits.length === 0 && (
              <li className="px-4 py-3 text-[12px] text-ink-faint">no matches</li>
            )}
            {hits.map((h) => (
              <li key={h.chunkId} className="px-4 py-3">
                <div className="text-[12px] text-ink-muted flex justify-between">
                  <span className="font-mono">{h.filename ?? h.documentId}</span>
                  <span>{h.score.toFixed(3)}</span>
                </div>
                <div className="text-[12px] text-ink mt-1 whitespace-pre-wrap line-clamp-3">
                  {h.text.slice(0, 400)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

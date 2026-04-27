import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Input, Select, Button } from './ui';
import { trpc } from '../lib/trpc-client';
import { PROVIDER_PRESETS } from '../lib/provider-presets';

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openai-compat';

interface ModelCaps {
  free?: boolean;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  web?: boolean;
  fast?: boolean;
}

interface ProviderFormProps {
  onSubmit: (config: {
    id: string;
    type: ProviderType;
    /** empty string = keep existing key (edit mode) */
    apiKey: string;
    baseURL?: string;
    defaultModel?: string;
  }) => void;
  onCancel: () => void;
  initialType?: ProviderType;
  /** Present when editing an existing provider */
  initial?: {
    type?: ProviderType;
    id?: string;
    baseURL?: string;
    defaultModel?: string;
  };
}

function needsBaseURL(type: ProviderType): boolean {
  return type === 'openai-compat' || type === 'ollama';
}
function needsAPIKey(type: ProviderType): boolean {
  return type !== 'ollama';
}
/** Whether we have enough credentials to probe the API */
function canProbe(type: ProviderType, apiKey: string, baseURL: string): boolean {
  if (type === 'ollama') return true; // no key needed
  if (type === 'openai-compat') return !!baseURL.trim() && !!apiKey.trim(); // both required
  return !!apiKey.trim();
}

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ok'; models: Array<{ id: string; label?: string; caps?: ModelCaps }> }
  | { status: 'error'; hint?: string };

type ModelTestResult =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; request: unknown; response: unknown }
  | { status: 'fail'; request: unknown; error: string };

// Sanitize raw API error — strip potential key echoes / account info
function sanitizeError(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/Bearer [A-Za-z0-9._-]{10,}/gi, 'Bearer ***')
    .slice(0, 300);
}

export function ProviderForm({ onSubmit, onCancel, initialType = 'openai', initial }: ProviderFormProps) {
  const { t } = useTranslation();
  const isEditing = !!initial?.id;

  const [type, setType] = useState<ProviderType>(initial?.type ?? initialType);
  const [name, setName] = useState(initial?.id ?? '');
  // In edit mode apiKey starts empty — user leaves blank to keep existing
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? '');
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? '');
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });
  const [modelCustom, setModelCustom] = useState(false);
  const [modelListOpen, setModelListOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [capFilter, setCapFilter] = useState<Set<keyof ModelCaps>>(new Set());
  const [modelTestResult, setModelTestResult] = useState<ModelTestResult>({ status: 'idle' });
  const [showDebug, setShowDebug] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const modelTestIdRef = useRef(0);
  const probeIdRef = useRef(0);

  const showBaseURL = needsBaseURL(type);
  const showAPIKey = needsAPIKey(type);
  const probeReady = canProbe(type, apiKey, baseURL);

  // ── Probe: only fire when we have enough credentials ────────────────────
  const runProbe = React.useCallback(async () => {
    if (!canProbe(type, apiKey, baseURL)) {
      setProbe({ status: 'idle' });
      return;
    }
    const id = ++probeIdRef.current;
    setProbe({ status: 'probing' });
    try {
      const res = await trpc.provider.listModels.query({
        type,
        baseURL: baseURL.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      if (id !== probeIdRef.current) return;
      if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
        setProbe({ status: 'ok', models: res.models });
      } else {
        const hint = !res.ok ? sanitizeError((res as { error?: string }).error ?? '') : undefined;
        setProbe({ status: 'error', hint });
      }
    } catch (e) {
      if (id !== probeIdRef.current) return;
      setProbe({ status: 'error', hint: sanitizeError(e instanceof Error ? e.message : String(e)) });
    }
  }, [type, baseURL, apiKey]);

  useEffect(() => {
    const handle = setTimeout(() => { void runProbe(); }, 500);
    return () => clearTimeout(handle);
  }, [runProbe]);

  // ── Model test ───────────────────────────────────────────────────────────
  const runModelTest = React.useCallback(async (model: string) => {
    if (!model.trim() || !canProbe(type, apiKey, baseURL)) {
      setModelTestResult({ status: 'idle' });
      return;
    }
    const id = ++modelTestIdRef.current;
    setModelTestResult({ status: 'testing' });
    try {
      const res = await trpc.provider.testModel.query({
        type,
        baseURL: baseURL.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
      });
      if (id !== modelTestIdRef.current) return;
      if (res.ok) {
        setModelTestResult({ status: 'ok', request: res.request, response: res.response });
      } else {
        setModelTestResult({
          status: 'fail',
          request: (res as { request?: unknown }).request ?? null,
          error: sanitizeError((res as { error?: string }).error ?? 'Unknown error'),
        });
      }
    } catch (e) {
      if (id !== modelTestIdRef.current) return;
      setModelTestResult({
        status: 'fail',
        request: { model },
        error: sanitizeError(e instanceof Error ? e.message : String(e)),
      });
    }
  }, [type, baseURL, apiKey]);

  // Debounced auto-test on model change; reset result immediately so stale ✓ never lingers
  useEffect(() => {
    setModelTestResult({ status: 'idle' });
    setShowDebug(false);
    if (!defaultModel.trim()) return;
    const handle = setTimeout(() => { void runModelTest(defaultModel); }, 700);
    return () => clearTimeout(handle);
  }, [defaultModel, runModelTest]);

  // ── Test badge ───────────────────────────────────────────────────────────
  const renderTestBadge = () => {
    const r = modelTestResult;
    if (r.status === 'idle') return null;

    let badge: React.ReactNode;
    if (r.status === 'testing') {
      badge = (
        <span className="inline-flex items-center gap-1.5 text-ink-faint">
          <span className="inline-block w-3 h-3 border-2 border-ink-faint border-t-transparent rounded-full animate-spin" />
          {t('providerForm.modelTesting')}
        </span>
      );
    } else if (r.status === 'ok') {
      badge = <span className="text-green-500">{t('providerForm.modelTestOk')}</span>;
    } else {
      badge = <span className="text-danger">{t('providerForm.modelTestFail')}: {r.error}</span>;
    }

    const hasDetails = r.status === 'ok' || r.status === 'fail';

    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-2 text-[12px]">
          {badge}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDebug((v) => !v)}
              className="text-ink-faint hover:text-accent transition-colors underline underline-offset-2 text-[11px]"
            >
              {showDebug ? t('providerForm.debugHide') : t('providerForm.debugShow')}
            </button>
          )}
        </div>
        {hasDetails && showDebug && (
          <div className="rounded-[6px] border border-rule bg-surface-2 text-[11px] font-mono overflow-auto max-h-56 p-2 space-y-2">
            <div>
              <p className="text-ink-faint mb-0.5 font-sans uppercase tracking-[0.06em] text-[10px]">Request</p>
              <pre className="whitespace-pre-wrap break-all text-ink">
                {JSON.stringify((r as { request: unknown }).request, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-ink-faint mb-0.5 font-sans uppercase tracking-[0.06em] text-[10px]">
                {r.status === 'ok' ? 'Response' : 'Error'}
              </p>
              <pre className="whitespace-pre-wrap break-all text-ink">
                {r.status === 'ok' ? JSON.stringify(r.response, null, 2) : r.error}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!defaultModel.trim() && !isEditing) {
      setSubmitError(t('providerForm.modelRequired'));
      return;
    }
    setSubmitError('');
    // In edit mode keep the original id; never re-derive (would create a duplicate)
    const id = isEditing
      ? (initial!.id as string)
      : (name.trim().toLowerCase().replace(/\s+/g, '-') || type);
    onSubmit({
      id,
      type,
      apiKey: apiKey.trim(), // empty string = keep existing (caller must handle)
      baseURL: baseURL.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
    });
  };

  // ── Filtered model list (memoized, used when probe.status === 'ok') ───────
  const probeModels = probe.status === 'ok' ? probe.models : [];
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    return probeModels.filter((m) => {
      if (q && !m.id.toLowerCase().includes(q) && !(m.label ?? '').toLowerCase().includes(q)) return false;
      if (capFilter.size > 0) {
        for (const cap of capFilter) {
          if (!m.caps?.[cap]) return false;
        }
      }
      return true;
    });
  }, [probeModels, modelSearch, capFilter]);

  // ── Model selector ───────────────────────────────────────────────────────
  const renderModelControl = () => {
    if (modelCustom) {
      return (
        <div className="space-y-1">
          <Input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={t('providerForm.modelCustomPlaceholder')}
            spellCheck={false}
            autoFocus
          />
          {renderTestBadge()}
          <button
            type="button"
            onClick={() => { setModelCustom(false); setDefaultModel(''); setModelTestResult({ status: 'idle' }); }}
            className="text-[11px] text-ink-faint hover:text-accent transition-colors"
          >
            {t('providerForm.modelCustomBack')}
          </button>
        </div>
      );
    }

    if (probe.status === 'probing') {
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 h-9 px-3 rounded-[6px] border border-rule bg-surface text-[13px] text-ink-faint">
            <span className="inline-block w-3 h-3 border-2 border-ink-faint border-t-transparent rounded-full animate-spin shrink-0" />
            {t('providerForm.modelProbing')}
          </div>
        </div>
      );
    }

    if (probe.status === 'ok') {
      const allModels = probe.models;
      const filtered = filteredModels;

      const CAP_LABELS: Array<{ key: keyof ModelCaps; emoji: string; label: string }> = [
        { key: 'free',      emoji: '🆓', label: t('providerForm.capFree') },
        { key: 'tools',     emoji: '🔧', label: t('providerForm.capTools') },
        { key: 'vision',    emoji: '👁',  label: t('providerForm.capVision') },
        { key: 'reasoning', emoji: '🧠', label: t('providerForm.capReasoning') },
        { key: 'web',       emoji: '🌐', label: t('providerForm.capWeb') },
        { key: 'fast',      emoji: '⚡', label: t('providerForm.capFast') },
      ];

      const toggleCap = (cap: keyof ModelCaps) => {
        setCapFilter((prev) => {
          const next = new Set(prev);
          if (next.has(cap)) next.delete(cap); else next.add(cap);
          return next;
        });
      };

      const selectedModel = allModels.find(m => m.id === defaultModel);

      // Collapsed state: model selected and list closed
      if (!modelListOpen && defaultModel) {
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2 h-9 px-3 rounded-[6px] border border-rule bg-surface">
              <span className="flex-1 truncate text-[12px] font-mono text-ink">{selectedModel?.label || defaultModel}</span>
              <span className="shrink-0 flex items-center gap-0.5 text-[11px]">
                {selectedModel?.caps?.free      && <span title={t('providerForm.capFree')}>🆓</span>}
                {selectedModel?.caps?.tools     && <span title={t('providerForm.capTools')}>🔧</span>}
                {selectedModel?.caps?.vision    && <span title={t('providerForm.capVision')}>👁</span>}
                {selectedModel?.caps?.reasoning && <span title={t('providerForm.capReasoning')}>🧠</span>}
                {selectedModel?.caps?.web       && <span title={t('providerForm.capWeb')}>🌐</span>}
                {selectedModel?.caps?.fast      && <span title={t('providerForm.capFast')}>⚡</span>}
              </span>
              <button
                type="button"
                onClick={() => setModelListOpen(true)}
                className="shrink-0 text-[11px] text-ink-faint hover:text-accent transition-colors"
              >
                {t('providerForm.modelPick')} ↓
              </button>
            </div>
            {renderTestBadge()}
          </div>
        );
      }

      return (
        <div className="space-y-2">
          {/* Search + refresh row */}
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={t('providerForm.modelSearch')}
              spellCheck={false}
              className="flex-1 text-[12px] h-8"
            />
            <button
              type="button"
              onClick={() => void runProbe()}
              title={t('providerForm.modelRefresh')}
              aria-label={t('providerForm.modelRefresh')}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[6px] border border-rule text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5M13.5 2.5v3h-3M2.5 13.5v-3h3"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Cap filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {CAP_LABELS.map(({ key, emoji, label }) => {
              const active = capFilter.has(key);
              const hasAny = allModels.some(m => m.caps?.[key]);
              if (!hasAny) return null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleCap(key)}
                  className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] border transition-colors ${
                    active
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-2 border-rule text-ink-muted hover:border-accent hover:text-ink'
                  }`}
                >
                  {emoji} {label}
                </button>
              );
            })}
            {capFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setCapFilter(new Set())}
                className="text-[11px] text-ink-faint hover:text-danger transition-colors px-1"
              >
                ✕ {t('providerForm.capClear')}
              </button>
            )}
          </div>

          {/* Model list */}
          <div className="rounded-[6px] border border-rule bg-surface overflow-auto max-h-40">
            {filtered.length === 0 ? (
              <p className="text-[12px] text-ink-faint text-center py-4">{t('providerForm.modelNoMatch')}</p>
            ) : (
              <ol>
                {filtered.map((m) => {
                  const selected = defaultModel === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => { setDefaultModel(m.id); setModelListOpen(false); }}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 text-[12px] transition-colors hover:bg-surface-2 ${
                          selected ? 'bg-accent-muted text-accent font-medium' : 'text-ink'
                        }`}
                      >
                        <span className="flex-1 truncate font-mono">{m.label || m.id}</span>
                        <span className="shrink-0 flex items-center gap-0.5 text-[11px]">
                          {m.caps?.free      && <span title={t('providerForm.capFree')}>🆓</span>}
                          {m.caps?.tools     && <span title={t('providerForm.capTools')}>🔧</span>}
                          {m.caps?.vision    && <span title={t('providerForm.capVision')}>👁</span>}
                          {m.caps?.reasoning && <span title={t('providerForm.capReasoning')}>🧠</span>}
                          {m.caps?.web       && <span title={t('providerForm.capWeb')}>🌐</span>}
                          {m.caps?.fast      && <span title={t('providerForm.capFast')}>⚡</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Count hint */}
          <p className="text-[11px] text-ink-faint">
            {filtered.length} / {allModels.length} {t('providerForm.modelCount')}
          </p>

          {renderTestBadge()}
          <button
            type="button"
            onClick={() => { setModelCustom(true); setDefaultModel(''); }}
            className="text-[11px] text-ink-faint hover:text-accent transition-colors"
          >
            {t('providerForm.modelCustom')}
          </button>
        </div>
      );
    }

    // idle / error → free text
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={probeReady ? t('providerForm.modelPlaceholder') : t('providerForm.modelPlaceholderNoKey')}
            spellCheck={false}
            className="flex-1"
          />
        </div>
        {probe.status === 'error' && (
          <p className="text-[12px] text-amber-500">
            {t('providerForm.modelProbeFailed')}
            {probe.hint ? ` — ${probe.hint}` : ''}
          </p>
        )}
        {renderTestBadge()}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4 anim-fade-up">
      {/* Presets */}
      <div className="space-y-1">
        <p className="text-[12px] text-ink-faint">{t('providerForm.presets')}</p>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setType(preset.type);
                setBaseURL(preset.baseURL ?? '');
                setDefaultModel('');
                setModelCustom(false);
                setProbe({ status: 'idle' });
                setModelTestResult({ status: 'idle' });
                setModelSearch('');
                setCapFilter(new Set());
                if (!name.trim()) setName(preset.label);
              }}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                type === preset.type && baseURL === (preset.baseURL ?? '')
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 hover:bg-accent-soft'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Type — shown only when no preset or manual mode */}
        <Field label={t('providerForm.kindLabel')}>
          <Select value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">{t('providerForm.types.ollama')}</option>
            <option value="openai-compat">{t('providerForm.types.openaiCompat')}</option>
          </Select>
        </Field>

        <Field label={t('providerForm.nameLabel')} hint={t('providerForm.nameHint')}>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('providerForm.namePlaceholder')}
            required
          />
        </Field>

        {showAPIKey && (
          <Field
            label={t('providerForm.apiKey')}
            hint={isEditing ? t('providerForm.apiKeyEditHint') : undefined}
            className="md:col-span-2"
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEditing ? t('providerForm.apiKeyEditPlaceholder') : t('providerForm.apiKeyPlaceholder')}
              required={!isEditing} // not required in edit mode (blank = keep existing)
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        {showBaseURL && (
          <Field label={t('providerForm.baseURL')} className="md:col-span-2">
            <Input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={type === 'ollama' ? t('providerForm.baseURLPlaceholderOllama') : t('providerForm.baseURLPlaceholder')}
              spellCheck={false}
            />
          </Field>
        )}

        <Field label={t('providerForm.modelLabel')} hint={t('providerForm.modelHint')} className="md:col-span-2">
          {renderModelControl()}
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" variant="primary" size="sm">
          {t('providerForm.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('providerForm.cancel')}
        </Button>
        {submitError && (
          <span role="alert" className="text-[12px] text-danger">{submitError}</span>
        )}
      </div>
    </form>
  );
}

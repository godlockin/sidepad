import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Input, Select, Button } from './ui';
import { trpc } from '../lib/trpc-client';

type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'openai-compat';

interface ProviderFormProps {
  onSubmit: (config: {
    id: string;
    type: ProviderType;
    apiKey: string;
    baseURL?: string;
    defaultModel?: string;
  }) => void;
  onCancel: () => void;
  initialType?: ProviderType;
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

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ok'; models: Array<{ id: string; label?: string }> }
  | { status: 'error' };

export function ProviderForm({ onSubmit, onCancel, initialType = 'openai', initial }: ProviderFormProps) {
  const { t } = useTranslation();
  const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
    { value: 'openai', label: t('providerForm.types.openai') },
    { value: 'anthropic', label: t('providerForm.types.anthropic') },
    { value: 'ollama', label: t('providerForm.types.ollama') },
    { value: 'openai-compat', label: t('providerForm.types.openaiCompat') },
  ];
  const [type, setType] = useState<ProviderType>(initial?.type ?? initialType);
  const [name, setName] = useState(initial?.id ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? '');
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? '');
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' });
  const probeIdRef = useRef(0);

  const showBaseURL = needsBaseURL(type);
  const showAPIKey = needsAPIKey(type);

  const runProbe = React.useCallback(async () => {
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
      } else if (res.ok) {
        setProbe({ status: 'error' });
      } else {
        setProbe({ status: 'error' });
      }
    } catch {
      if (id !== probeIdRef.current) return;
      setProbe({ status: 'error' });
    }
  }, [type, baseURL, apiKey]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void runProbe();
    }, 400);
    return () => clearTimeout(handle);
  }, [runProbe]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = name.trim().toLowerCase().replace(/\s+/g, '-') || type;
    onSubmit({
      id,
      type,
      apiKey: apiKey.trim(),
      baseURL: baseURL.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
    });
  };

  const renderModelControl = () => {
    if (probe.status === 'probing') {
      return (
        <>
          <Input
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder={t('providerForm.modelPlaceholder')}
            spellCheck={false}
          />
          <p className="text-[12px] text-ink-faint mt-1">{t('providerForm.modelProbing')}</p>
        </>
      );
    }
    if (probe.status === 'ok') {
      const models = probe.models;
      const selectedInList = models.some((m) => m.id === defaultModel);
      return (
        <div className="flex items-center gap-2">
          <Select
            value={selectedInList ? defaultModel : ''}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="flex-1"
          >
            <option value="" disabled>
              {t('providerForm.modelPick')}
            </option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => void runProbe()}
            title={t('providerForm.modelRefresh')}
            aria-label={t('providerForm.modelRefresh')}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[6px] border border-rule text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5M13.5 2.5v3h-3M2.5 13.5v-3h3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      );
    }
    // idle or error → free-text input
    return (
      <>
        <Input
          type="text"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder={t('providerForm.modelPlaceholder')}
          spellCheck={false}
        />
        {probe.status === 'error' && (
          <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-[10px] bg-surface-2 text-[11px] text-ink-faint border border-rule">
            {t('providerForm.modelProbeFailed')}
          </span>
        )}
      </>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 anim-fade-up">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t('providerForm.kindLabel')}>
          <Select value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
            {PROVIDER_TYPES.map((pt) => (
              <option key={pt.value} value={pt.value}>
                {pt.label}
              </option>
            ))}
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
          <Field label={t('providerForm.apiKey')} className="md:col-span-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('providerForm.apiKeyPlaceholder')}
              required={showAPIKey}
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

        <Field
          label={t('providerForm.modelLabel')}
          hint={t('providerForm.modelHint')}
          className="md:col-span-2"
        >
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
      </div>
    </form>
  );
}

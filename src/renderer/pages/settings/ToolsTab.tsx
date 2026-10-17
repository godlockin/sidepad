import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { trpc } from '../../lib/trpc-client';

type ToolKeyName = 'brave_api_key' | 'tavily_api_key';

interface KeyStatus {
  brave_api_key: { set: boolean };
  tavily_api_key: { set: boolean };
}

export function ToolsTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [drafts, setDrafts] = useState<Record<ToolKeyName, string>>({
    brave_api_key: '',
    tavily_api_key: '',
  });
  const [saving, setSaving] = useState<ToolKeyName | null>(null);

  const [browserInstalled, setBrowserInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const [approvalMode, setApprovalMode] = useState<'off' | 'ask'>('off');
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [allowlistBusy, setAllowlistBusy] = useState(false);
  const [sandboxMode, setSandboxMode] = useState<'off' | 'project'>('project');
  const [sandboxSaving, setSandboxSaving] = useState(false);
  const [clfEnabled, setClfEnabled] = useState(false);
  const [clfProviderId, setClfProviderId] = useState('');
  const [clfModel, setClfModel] = useState('');
  const [clfThreshold, setClfThreshold] = useState('0.6');
  const [clfSaving, setClfSaving] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string }>>([]);

  const refresh = async () => {
    const res = (await trpc.settings.getToolKeys.query()) as KeyStatus;
    setStatus(res);
  };

  const refreshApproval = async () => {
    try {
      const res = await trpc.settings.getToolApprovalMode.query();
      setApprovalMode(res.mode);
      const list = await trpc.settings.getToolAllowlist.query();
      setAllowlist(list.tools);
    } catch {
      setApprovalMode('off');
      setAllowlist([]);
    }
  };

  const removeAllowed = async (name: string) => {
    setAllowlistBusy(true);
    try {
      const next = allowlist.filter((t) => t !== name);
      const res = await trpc.settings.setToolAllowlist.mutate({ tools: next });
      setAllowlist(res.tools);
    } finally {
      setAllowlistBusy(false);
    }
  };

  const clearAllowlist = async () => {
    setAllowlistBusy(true);
    try {
      await trpc.settings.setToolAllowlist.mutate({ tools: [] });
      setAllowlist([]);
    } finally {
      setAllowlistBusy(false);
    }
  };

  const refreshSandbox = async () => {
    try {
      const res = await trpc.settings.getSandboxMode.query();
      setSandboxMode(res.mode);
    } catch {
      setSandboxMode('project');
    }
  };

  const saveSandbox = async (mode: 'off' | 'project') => {
    setSandboxSaving(true);
    try {
      await trpc.settings.setSandboxMode.mutate({ mode });
      setSandboxMode(mode);
    } finally {
      setSandboxSaving(false);
    }
  };

  const refreshClassifier = async () => {
    try {
      const cfg = await trpc.classifier.getConfig.query();
      setClfEnabled(cfg.enabled);
      setClfProviderId(cfg.providerId);
      setClfModel(cfg.model);
      setClfThreshold(String(cfg.threshold));
      const list = await trpc.provider.list.query();
      setProviders(list.map((p) => ({ id: p.id })));
    } catch {
      /* ignore */
    }
  };

  const refreshBrowser = async () => {
    try {
      const installed = (await (trpc as any).mcp.isBrowserInstalled.query()) as boolean;
      setBrowserInstalled(installed);
    } catch {
      setBrowserInstalled(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshBrowser();
    void refreshApproval();
    void refreshSandbox();
    void refreshClassifier();
  }, []);

  const saveApproval = async (mode: 'off' | 'ask') => {
    setApprovalSaving(true);
    try {
      await trpc.settings.setToolApprovalMode.mutate({ mode });
      setApprovalMode(mode);
    } finally {
      setApprovalSaving(false);
    }
  };

  const saveClassifier = async () => {
    const threshold = Number(clfThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return;
    setClfSaving(true);
    try {
      await trpc.classifier.configure.mutate({
        enabled: clfEnabled,
        providerId: clfProviderId,
        model: clfModel.trim(),
        timeoutMs: 8_000,
        threshold,
      });
    } finally {
      setClfSaving(false);
    }
  };

  // Auto-scroll the install log to the bottom whenever it grows.
  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [installLog]);

  const save = async (key: ToolKeyName) => {
    setSaving(key);
    try {
      await trpc.settings.setToolKey.mutate({ key, value: drafts[key] });
      setDrafts((d) => ({ ...d, [key]: '' }));
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  const startInstall = () => {
    if (installing) return;
    setInstalling(true);
    setInstallLog([]);
    const sub = (trpc as any).mcp.installBrowser.subscribe(undefined, {
      onData: (evt: { type: string; line?: string; ok?: boolean }) => {
        if (evt.type === 'progress' && evt.line) {
          setInstallLog((prev) => [...prev, evt.line!]);
        } else if (evt.type === 'error' && evt.line) {
          setInstallLog((prev) => [...prev, `[error] ${evt.line!}`]);
        } else if (evt.type === 'done') {
          setInstallLog((prev) => [
            ...prev,
            evt.ok ? '✓ done' : `✗ failed (code ${(evt as any).code})`,
          ]);
          setInstalling(false);
          void refreshBrowser();
        }
      },
      onError: (err: unknown) => {
        setInstallLog((prev) => [...prev, `[error] ${String(err)}`]);
        setInstalling(false);
      },
      onComplete: () => {
        setInstalling(false);
        void refreshBrowser();
        try {
          sub?.unsubscribe?.();
        } catch {
          /* ignore */
        }
      },
    });
  };

  const rows: { key: ToolKeyName; label: string }[] = [
    { key: 'brave_api_key', label: t('settings.tools.braveKey') },
    { key: 'tavily_api_key', label: t('settings.tools.tavilyKey') },
  ];

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('settings.tools.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">
        {t('settings.tools.searchHint')}
      </p>

      <div className="mt-6">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.tools.searchBackends')}
        </span>

        <div className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden divide-y divide-rule">
          {rows.map((row) => {
            const isSet = !!status?.[row.key]?.set;
            return (
              <div key={row.key} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`tools-${row.key}`}
                      className="text-[13px] font-medium text-ink"
                    >
                      {row.label}
                    </label>
                    {isSet && (
                      <span className="text-[10px] uppercase tracking-[0.08em] text-success">
                        ● {t('settings.tools.configured')}
                      </span>
                    )}
                  </div>
                  <input
                    id={`tools-${row.key}`}
                    type="password"
                    autoComplete="off"
                    placeholder={isSet ? '••••••••' : ''}
                    value={drafts[row.key]}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                    }
                    className="mt-2 w-full rounded-[6px] border border-rule bg-paper px-2 py-1.5 text-[13px] font-mono text-ink focus:border-accent focus:outline-none"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => save(row.key)}
                  disabled={
                    saving === row.key || drafts[row.key].trim().length === 0
                  }
                >
                  {saving === row.key ? '…' : 'Save'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.tools.approval.title')}
        </span>
        <p className="mt-2 text-[13px] text-ink-muted leading-[1.5]">
          {t('settings.tools.approval.body')}
        </p>
        {approvalMode === 'off' && (
          <p className="mt-2 text-[12px] text-warn leading-[1.5]">
            {t('settings.tools.approval.offWarn')}
          </p>
        )}
        <div className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden divide-y divide-rule">
          {([
            { key: 'off' as const, label: t('settings.tools.approval.off') },
            { key: 'ask' as const, label: t('settings.tools.approval.ask') },
          ]).map((opt) => {
            const active = approvalMode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={approvalSaving}
                onClick={() => void saveApproval(opt.key)}
                className={`w-full text-left px-4 py-3 text-[13px] cursor-pointer transition-colors ${
                  active ? 'bg-accent-muted text-accent font-medium' : 'text-ink hover:bg-surface-2'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="mt-6">
          <span className="text-[12px] font-medium text-ink">{t('settings.tools.sandbox.title')}</span>
          <p className="mt-1 text-[12px] text-ink-muted leading-[1.4]">{t('settings.tools.sandbox.body')}</p>
          <p className="mt-1 text-[12px] text-ink-faint leading-[1.4]">{t('settings.tools.sandbox.ptyHint')}</p>
          <div className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden divide-y divide-rule">
            {([
              { key: 'project' as const, label: t('settings.tools.sandbox.project') },
              { key: 'off' as const, label: t('settings.tools.sandbox.off') },
            ]).map((opt) => {
              const active = sandboxMode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={sandboxSaving}
                  onClick={() => void saveSandbox(opt.key)}
                  className={`w-full text-left px-4 py-3 text-[13px] cursor-pointer transition-colors ${
                    active ? 'bg-accent-muted text-accent font-medium' : 'text-ink hover:bg-surface-2'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {approvalMode === 'ask' && (
          <div className="mt-4 border border-rule rounded-[10px] bg-surface p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12px] font-medium text-ink">{t('settings.tools.approval.allowlistTitle')}</span>
              {allowlist.length > 0 && (
                <button
                  type="button"
                  disabled={allowlistBusy}
                  onClick={() => void clearAllowlist()}
                  className="ml-auto text-[11px] text-ink-muted hover:text-danger cursor-pointer disabled:opacity-50"
                >
                  {t('settings.tools.approval.allowlistClear')}
                </button>
              )}
            </div>
            <p className="text-[12px] text-ink-muted mb-3 leading-[1.4]">
              {t('settings.tools.approval.allowlistBody')}
            </p>
            {allowlist.length === 0 ? (
              <p className="text-[12px] text-ink-faint">{t('settings.tools.approval.allowlistEmpty')}</p>
            ) : (
              <ul className="space-y-1.5">
                {allowlist.map((name) => (
                  <li
                    key={name}
                    className="flex items-center gap-2 text-[12px] font-mono text-ink bg-paper border border-rule rounded-[6px] px-2 py-1.5"
                  >
                    <span className="flex-1 truncate">{name}</span>
                    <button
                      type="button"
                      disabled={allowlistBusy}
                      onClick={() => void removeAllowed(name)}
                      className="text-ink-faint hover:text-danger cursor-pointer disabled:opacity-50 text-[14px] leading-none"
                      aria-label={`Remove ${name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.classifier.title')}
        </span>
        <p className="mt-2 text-[13px] text-ink-muted leading-[1.5]">
          {t('settings.classifier.body')}
        </p>
        <div className="mt-3 border border-rule rounded-[10px] bg-surface p-4 space-y-3">
          <label className="flex items-center gap-2 text-[13px] text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={clfEnabled}
              onChange={(e) => setClfEnabled(e.target.checked)}
            />
            {t('settings.classifier.enable')}
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-faint">{t('settings.classifier.provider')}</span>
            <select
              value={clfProviderId}
              onChange={(e) => setClfProviderId(e.target.value)}
              disabled={!clfEnabled}
              className="mt-1 w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] disabled:opacity-50"
            >
              <option value="">{t('settings.classifier.pickProvider')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-faint">{t('settings.classifier.model')}</span>
            <input
              value={clfModel}
              onChange={(e) => setClfModel(e.target.value)}
              disabled={!clfEnabled}
              placeholder="gpt-4o-mini"
              className="mt-1 w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] font-mono disabled:opacity-50"
            />
          </label>
          <label className="block w-[120px]">
            <span className="text-[11px] text-ink-faint">{t('settings.classifier.threshold')}</span>
            <input
              value={clfThreshold}
              onChange={(e) => setClfThreshold(e.target.value)}
              disabled={!clfEnabled}
              inputMode="decimal"
              className="mt-1 w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] tabular-nums disabled:opacity-50"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={clfSaving || (clfEnabled && (!clfProviderId || !clfModel.trim()))}
            onClick={() => void saveClassifier()}
          >
            {t('settings.classifier.save')}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {t('settings.tools.browser.title')}
        </span>

        <div className="mt-3 border border-rule rounded-[10px] bg-surface overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink">
                  {t('settings.tools.browser.title')}
                </span>
                {browserInstalled === true && (
                  <span className="text-[10px] uppercase tracking-[0.08em] text-success">
                    ✓ {t('settings.tools.browser.installed')}
                  </span>
                )}
                {browserInstalled === false && (
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                    ✗ {t('settings.tools.browser.notInstalled')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-ink-muted">
                {t('settings.tools.browser.required')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={startInstall}
              disabled={installing || browserInstalled === true}
            >
              {installing
                ? t('settings.tools.browser.installing')
                : t('settings.tools.browser.install')}
            </Button>
          </div>

          {(installing || installLog.length > 0) && (
            <div className="border-t border-rule px-4 py-3">
              <div
                ref={logBoxRef}
                className="max-h-40 overflow-auto rounded-[6px] border border-rule bg-paper p-2 font-mono text-[11px] leading-[1.5] text-ink whitespace-pre-wrap"
              >
                {installLog.length === 0 ? '…' : installLog.join('\n')}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

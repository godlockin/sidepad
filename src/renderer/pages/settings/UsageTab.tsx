import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading, Button } from '../../components/ui';
import { trpc } from '../../lib/trpc-client';

type Period = 7 | 30 | 90 | null;

type Summary = Awaited<ReturnType<typeof trpc.usage.summarize.query>>;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsd(n: number | null): string {
  if (n == null) return '—';
  if (n < 0.01 && n > 0) return '<$0.01';
  return `$${n.toFixed(n < 10 ? 3 : 2)}`;
}

export function UsageTab() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [priceModel, setPriceModel] = useState('');
  const [priceIn, setPriceIn] = useState('');
  const [priceOut, setPriceOut] = useState('');
  const [pricingBusy, setPricingBusy] = useState(false);
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [budgetMax, setBudgetMax] = useState('');
  const [budgetDays, setBudgetDays] = useState('30');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetSpent, setBudgetSpent] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trpc.usage.summarize.query({
        days: period,
        sessionLimit: 15,
      });
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadBudget = useCallback(async () => {
    try {
      const b = await trpc.settings.getUsageBudget.query();
      setBudgetEnabled(b.enabled);
      setBudgetMax(b.maxUsd != null ? String(b.maxUsd) : '');
      setBudgetDays(String(b.periodDays ?? 30));
      if (b.enabled && b.maxUsd != null) {
        const days = b.periodDays ?? 30;
        const periodSummary = await trpc.usage.summarize.query({ days, sessionLimit: 1 });
        setBudgetSpent(periodSummary.estimatedCostUsd);
      } else {
        setBudgetSpent(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBudget();
  }, [load, loadBudget]);

  const saveBudget = async () => {
    const maxUsd = budgetMax.trim() === '' ? null : Number(budgetMax);
    const periodDays = Number(budgetDays) || 30;
    if (maxUsd != null && (!Number.isFinite(maxUsd) || maxUsd < 0)) return;
    setBudgetBusy(true);
    try {
      await trpc.settings.setUsageBudget.mutate({
        enabled: budgetEnabled,
        maxUsd,
        periodDays,
      });
      await loadBudget();
    } finally {
      setBudgetBusy(false);
    }
  };

  const periods: { key: Period; label: string }[] = [
    { key: 7, label: t('settings.usage.period7') },
    { key: 30, label: t('settings.usage.period30') },
    { key: 90, label: t('settings.usage.period90') },
    { key: null, label: t('settings.usage.periodAll') },
  ];

  const handleAddPricing = async () => {
    const modelId = priceModel.trim();
    const inputPer1M = Number(priceIn);
    const outputPer1M = Number(priceOut);
    if (!modelId || !Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) return;
    if (inputPer1M < 0 || outputPer1M < 0) return;
    setPricingBusy(true);
    try {
      await trpc.usage.upsertPricing.mutate({ modelId, inputPer1M, outputPer1M });
      setPriceModel('');
      setPriceIn('');
      setPriceOut('');
      await load();
    } finally {
      setPricingBusy(false);
    }
  };

  const handleDeletePricing = async (modelId: string) => {
    setPricingBusy(true);
    try {
      await trpc.usage.deletePricing.mutate({ modelId });
      await load();
    } finally {
      setPricingBusy(false);
    }
  };

  const pricingEntries = Object.entries(summary?.pricing ?? {});

  return (
    <section>
      <Heading level={1} className="mb-2">
        {t('settings.usage.title')}
      </Heading>
      <p className="text-[14px] leading-[1.6] text-ink-muted">{t('settings.usage.body')}</p>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-2">
        {periods.map((p) => {
          const active = period === p.key;
          return (
            <button
              key={String(p.key)}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={active}
              className={`px-3 py-1 rounded-[6px] text-[12px] font-medium border cursor-pointer transition-colors duration-[var(--dur-fast)] ${
                active
                  ? 'bg-accent-muted text-accent border-accent'
                  : 'text-ink-muted border-rule hover:text-ink hover:bg-surface'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto text-[12px] text-ink-muted hover:text-ink cursor-pointer"
        >
          {t('settings.usage.refresh')}
        </button>
      </div>

      {loading && !summary && (
        <p className="text-[13px] text-ink-faint">{t('settings.usage.loading')}</p>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}

      <div className="mb-6 border border-rule rounded-[10px] bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint mb-1">
          {t('settings.budget.title')}
        </h2>
        <p className="text-[12px] text-ink-muted mb-3 leading-[1.5]">{t('settings.budget.body')}</p>
        <label className="flex items-center gap-2 text-[13px] text-ink mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={budgetEnabled}
            onChange={(e) => setBudgetEnabled(e.target.checked)}
          />
          {t('settings.budget.enable')}
        </label>
        {budgetEnabled && budgetMax.trim() !== '' && budgetSpent != null ? (
          <p
            className={`text-[12px] mb-3 tabular-nums ${
              Number(budgetMax) > 0 && budgetSpent / Number(budgetMax) >= 0.8
                ? 'text-warn'
                : 'text-ink-muted'
            }`}
          >
            {Number(budgetMax) > 0 && budgetSpent / Number(budgetMax) >= 0.8
              ? `${t('settings.budget.warnNear')} · `
              : ''}
            {t('settings.budget.status', {
              spent: formatUsd(budgetSpent),
              cap: formatUsd(Number(budgetMax)),
            })}
          </p>
        ) : (
          <p className="text-[12px] text-ink-faint mb-3">{t('settings.budget.statusUnlimited')}</p>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="w-[100px]">
            <span className="block text-[11px] text-ink-faint mb-1">{t('settings.budget.maxUsd')}</span>
            <input
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              placeholder="10"
              inputMode="decimal"
              disabled={!budgetEnabled}
              className="w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] tabular-nums disabled:opacity-50"
            />
          </label>
          <label className="w-[100px]">
            <span className="block text-[11px] text-ink-faint mb-1">{t('settings.budget.periodDays')}</span>
            <input
              value={budgetDays}
              onChange={(e) => setBudgetDays(e.target.value)}
              placeholder="30"
              inputMode="numeric"
              disabled={!budgetEnabled}
              className="w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] tabular-nums disabled:opacity-50"
            />
          </label>
          <Button variant="ghost" size="sm" disabled={budgetBusy} onClick={() => void saveBudget()}>
            {t('settings.budget.save')}
          </Button>
        </div>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Stat
              label={t('settings.usage.totalTokens')}
              value={formatTokens(summary.totalPromptTokens + summary.totalCompletionTokens)}
              hint={`${formatTokens(summary.totalPromptTokens)} in · ${formatTokens(summary.totalCompletionTokens)} out`}
            />
            <Stat label={t('settings.usage.totalCalls')} value={String(summary.totalCalls)} />
            <Stat
              label={t('settings.usage.estCost')}
              value={formatUsd(summary.estimatedCostUsd)}
              hint={t('settings.usage.estCostHint')}
            />
          </div>

          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint mb-2">
            {t('settings.usage.byModel')}
          </h2>
          <div className="border border-rule rounded-[10px] bg-surface overflow-hidden mb-6">
            {summary.byModel.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-faint text-center">
                {t('settings.usage.empty')}
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-faint border-b border-rule">
                    <th className="px-3 py-2 font-medium">{t('settings.usage.colModel')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('settings.usage.colIn')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('settings.usage.colOut')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('settings.usage.colCalls')}</th>
                    <th className="px-3 py-2 font-medium text-right">{t('settings.usage.colCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((row) => (
                    <tr
                      key={`${row.providerId ?? ''}:${row.modelId ?? ''}`}
                      className="border-b border-rule last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono text-[12px] text-ink truncate max-w-[220px]">
                          {row.modelId ?? '—'}
                        </div>
                        {row.providerId && (
                          <div className="text-[11px] text-ink-faint truncate">{row.providerId}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {formatTokens(row.promptTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {formatTokens(row.completionTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{row.calls}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatUsd(row.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint mb-2">
            {t('settings.usage.bySession')}
          </h2>
          <div className="border border-rule rounded-[10px] bg-surface overflow-hidden mb-6">
            {summary.bySession.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-faint text-center">
                {t('settings.usage.empty')}
              </p>
            ) : (
              <ul>
                {summary.bySession.map((row) => (
                  <li
                    key={row.sessionId}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-rule last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink truncate">
                        {row.title?.trim() || t('settings.usage.untitled')}
                      </div>
                      <div className="text-[11px] text-ink-faint tabular-nums">
                        {formatTokens(row.promptTokens + row.completionTokens)} · {row.calls}{' '}
                        {t('settings.usage.callsUnit')}
                      </div>
                    </div>
                    <div className="text-[13px] tabular-nums text-ink-muted shrink-0">
                      {formatUsd(row.estimatedCostUsd)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowPricing((v) => !v)}
            className="text-[12px] font-medium text-accent cursor-pointer mb-3"
          >
            {showPricing ? t('settings.usage.hidePricing') : t('settings.usage.showPricing')}
          </button>

          {showPricing && (
            <div className="border border-rule rounded-[10px] bg-surface p-4">
              <p className="text-[12px] text-ink-muted mb-3 leading-[1.5]">
                {t('settings.usage.pricingBody')}
              </p>
              {pricingEntries.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {pricingEntries.map(([id, rate]) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 text-[12px] font-mono text-ink"
                    >
                      <span className="flex-1 truncate">{id}</span>
                      <span className="text-ink-muted tabular-nums">
                        ${rate.inputPer1M} / ${rate.outputPer1M}
                      </span>
                      <button
                        type="button"
                        disabled={pricingBusy}
                        onClick={() => void handleDeletePricing(id)}
                        className="text-ink-faint hover:text-danger cursor-pointer"
                      >
                        {t('settings.usage.remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 items-end">
                <label className="flex-1 min-w-[120px]">
                  <span className="block text-[11px] text-ink-faint mb-1">
                    {t('settings.usage.priceModel')}
                  </span>
                  <input
                    value={priceModel}
                    onChange={(e) => setPriceModel(e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] font-mono"
                  />
                </label>
                <label className="w-[88px]">
                  <span className="block text-[11px] text-ink-faint mb-1">
                    {t('settings.usage.priceIn')}
                  </span>
                  <input
                    value={priceIn}
                    onChange={(e) => setPriceIn(e.target.value)}
                    placeholder="2.5"
                    inputMode="decimal"
                    className="w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] tabular-nums"
                  />
                </label>
                <label className="w-[88px]">
                  <span className="block text-[11px] text-ink-faint mb-1">
                    {t('settings.usage.priceOut')}
                  </span>
                  <input
                    value={priceOut}
                    onChange={(e) => setPriceOut(e.target.value)}
                    placeholder="10"
                    inputMode="decimal"
                    className="w-full px-2 py-1.5 rounded-[6px] border border-rule bg-paper text-[13px] tabular-nums"
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pricingBusy}
                  onClick={() => void handleAddPricing()}
                >
                  {t('settings.usage.savePrice')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-rule rounded-[10px] bg-surface px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-faint mb-1">{label}</div>
      <div className="text-[20px] font-medium tabular-nums text-ink leading-tight">{value}</div>
      {hint && <div className="text-[11px] text-ink-faint mt-1 leading-[1.4]">{hint}</div>}
    </div>
  );
}

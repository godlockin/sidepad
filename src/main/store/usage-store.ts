import type Database from 'better-sqlite3';
import { createAppSettingsStore } from './app-settings-store.js';

export interface ModelPricing {
  /** USD per 1M prompt tokens */
  inputPer1M: number;
  /** USD per 1M completion tokens */
  outputPer1M: number;
}

export interface UsageByModel {
  providerId: string | null;
  modelId: string | null;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  estimatedCostUsd: number | null;
}

export interface UsageBySession {
  sessionId: string;
  title: string | null;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  estimatedCostUsd: number | null;
}

export interface UsageSummary {
  since: number | null;
  until: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCalls: number;
  estimatedCostUsd: number | null;
  byModel: UsageByModel[];
  bySession: UsageBySession[];
  pricing: Record<string, ModelPricing>;
}

const PRICING_SETTING_KEY = 'model_pricing';

/**
 * Built-in USD/1M estimates for common models. Used when the user has not
 * set a custom rate. Matched by longest case-insensitive substring of model id.
 * Local / unknown models resolve to null cost (not $0) so the UI can show "—".
 */
export const DEFAULT_MODEL_PRICING: Array<{ match: string; pricing: ModelPricing }> = [
  { match: 'gpt-4o-mini', pricing: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { match: 'gpt-4o', pricing: { inputPer1M: 2.5, outputPer1M: 10 } },
  { match: 'gpt-4.1-mini', pricing: { inputPer1M: 0.4, outputPer1M: 1.6 } },
  { match: 'gpt-4.1', pricing: { inputPer1M: 2, outputPer1M: 8 } },
  { match: 'gpt-5', pricing: { inputPer1M: 1.25, outputPer1M: 10 } },
  { match: 'o3-mini', pricing: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { match: 'o3', pricing: { inputPer1M: 2, outputPer1M: 8 } },
  { match: 'o1-mini', pricing: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { match: 'o1', pricing: { inputPer1M: 15, outputPer1M: 60 } },
  { match: 'claude-opus-4', pricing: { inputPer1M: 15, outputPer1M: 75 } },
  { match: 'claude-sonnet-4', pricing: { inputPer1M: 3, outputPer1M: 15 } },
  { match: 'claude-haiku-4', pricing: { inputPer1M: 0.8, outputPer1M: 4 } },
  { match: 'claude-3-5-haiku', pricing: { inputPer1M: 0.8, outputPer1M: 4 } },
  { match: 'claude-3-5-sonnet', pricing: { inputPer1M: 3, outputPer1M: 15 } },
  { match: 'claude-3-opus', pricing: { inputPer1M: 15, outputPer1M: 75 } },
  { match: 'gemini-2.5-pro', pricing: { inputPer1M: 1.25, outputPer1M: 10 } },
  { match: 'gemini-2.5-flash-lite', pricing: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  { match: 'gemini-2.5-flash', pricing: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { match: 'deepseek-chat', pricing: { inputPer1M: 0.27, outputPer1M: 1.1 } },
  { match: 'deepseek-reasoner', pricing: { inputPer1M: 0.55, outputPer1M: 2.19 } },
];

export function resolveModelPricing(
  modelId: string | null | undefined,
  custom: Record<string, ModelPricing>,
): ModelPricing | null {
  if (!modelId) return null;
  const exact = custom[modelId];
  if (exact) return exact;
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(custom)) {
    if (lower.includes(key.toLowerCase())) return pricing;
  }
  // Longest built-in match wins (list is ordered specific → general within families,
  // but we still pick the longest match string for safety).
  let best: { len: number; pricing: ModelPricing } | null = null;
  for (const row of DEFAULT_MODEL_PRICING) {
    if (!lower.includes(row.match)) continue;
    if (!best || row.match.length > best.len) {
      best = { len: row.match.length, pricing: row.pricing };
    }
  }
  return best?.pricing ?? null;
}

export function estimateCostUsd(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing | null,
): number | null {
  if (!pricing) return null;
  return (promptTokens / 1_000_000) * pricing.inputPer1M + (completionTokens / 1_000_000) * pricing.outputPer1M;
}

export interface UsageStore {
  getPricing(): Record<string, ModelPricing>;
  setPricing(pricing: Record<string, ModelPricing>): void;
  summarize(opts?: { since?: number | null; sessionLimit?: number }): UsageSummary;
}

export interface BudgetConfig {
  enabled: boolean;
  maxUsd: number | null;
  periodDays: number;
  /** Lifetime estimated spend cap for a single chat session. Null = no session cap. */
  sessionMaxUsd: number | null;
}

export const BUDGET_SETTING_KEY = 'usage_budget';

export function readBudgetConfig(db: Database.Database): BudgetConfig {
  const raw = createAppSettingsStore(db).getSetting(BUDGET_SETTING_KEY);
  if (!raw) return { enabled: false, maxUsd: null, periodDays: 30, sessionMaxUsd: null };
  try {
    const parsed = JSON.parse(raw) as Partial<BudgetConfig>;
    return {
      enabled: !!parsed.enabled,
      maxUsd: typeof parsed.maxUsd === 'number' && Number.isFinite(parsed.maxUsd) ? parsed.maxUsd : null,
      periodDays:
        typeof parsed.periodDays === 'number' && parsed.periodDays > 0
          ? Math.min(3650, Math.floor(parsed.periodDays))
          : 30,
      sessionMaxUsd:
        typeof parsed.sessionMaxUsd === 'number' && Number.isFinite(parsed.sessionMaxUsd)
          ? parsed.sessionMaxUsd
          : null,
    };
  } catch {
    return { enabled: false, maxUsd: null, periodDays: 30, sessionMaxUsd: null };
  }
}

/** Estimated USD already recorded for one session (all time). */
export function sessionSpendUsd(db: Database.Database, sessionId: string): number {
  const pricing = createUsageStore(db).getPricing();
  const rows = db
    .prepare(
      `SELECT model_id,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM messages
       WHERE session_id = ? AND role = 'assistant'
         AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
       GROUP BY model_id`,
    )
    .all(sessionId) as Array<{
    model_id: string | null;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  let spent = 0;
  for (const row of rows) {
    const rate = resolveModelPricing(row.model_id, pricing);
    const part = estimateCostUsd(Number(row.prompt_tokens) || 0, Number(row.completion_tokens) || 0, rate);
    if (part != null) spent += part;
  }
  return spent;
}

/** Returns overspend info when an enabled USD cap is exceeded. */
export function checkBudget(
  db: Database.Database,
  sessionId?: string,
): {
  ok: boolean;
  spentUsd: number | null;
  maxUsd: number | null;
  scope: 'period' | 'session' | null;
} {
  const cfg = readBudgetConfig(db);
  if (!cfg.enabled) {
    return { ok: true, spentUsd: null, maxUsd: cfg.maxUsd, scope: null };
  }
  if (cfg.maxUsd != null) {
    const since = Math.floor(Date.now() / 1000) - cfg.periodDays * 86_400;
    const summary = createUsageStore(db).summarize({ since });
    const spent = summary.estimatedCostUsd ?? 0;
    if (spent >= cfg.maxUsd) {
      return { ok: false, spentUsd: spent, maxUsd: cfg.maxUsd, scope: 'period' };
    }
  }
  if (cfg.sessionMaxUsd != null && sessionId) {
    const spent = sessionSpendUsd(db, sessionId);
    if (spent >= cfg.sessionMaxUsd) {
      return { ok: false, spentUsd: spent, maxUsd: cfg.sessionMaxUsd, scope: 'session' };
    }
  }
  return { ok: true, spentUsd: null, maxUsd: cfg.maxUsd, scope: null };
}

export function createUsageStore(db: Database.Database): UsageStore {
  const settings = createAppSettingsStore(db);

  function getPricing(): Record<string, ModelPricing> {
    const raw = settings.getSetting(PRICING_SETTING_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, ModelPricing>;
      if (!parsed || typeof parsed !== 'object') return {};
      const out: Record<string, ModelPricing> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        const inputPer1M = Number((v as ModelPricing).inputPer1M);
        const outputPer1M = Number((v as ModelPricing).outputPer1M);
        if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) continue;
        if (inputPer1M < 0 || outputPer1M < 0) continue;
        out[k] = { inputPer1M, outputPer1M };
      }
      return out;
    } catch {
      return {};
    }
  }

  return {
    getPricing,
    setPricing(pricing) {
      settings.setSetting(PRICING_SETTING_KEY, JSON.stringify(pricing));
    },
    summarize(opts = {}) {
      const since = opts.since ?? null;
      const sessionLimit = opts.sessionLimit ?? 20;
      const until = Math.floor(Date.now() / 1000);
      const pricing = getPricing();

      const sinceClause = since != null ? 'AND m.created_at >= ?' : '';
      const sinceParams = since != null ? [since] : [];

      const modelRows = db
        .prepare(
          `
          SELECT
            json_extract(m.meta_json, '$.providerId') AS provider_id,
            m.model_id AS model_id,
            COALESCE(SUM(m.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) AS completion_tokens,
            COUNT(*) AS calls
          FROM messages m
          WHERE m.role = 'assistant'
            AND (m.prompt_tokens IS NOT NULL OR m.completion_tokens IS NOT NULL)
            ${sinceClause}
          GROUP BY provider_id, model_id
          ORDER BY (prompt_tokens + completion_tokens) DESC
          `,
        )
        .all(...sinceParams) as Array<{
        provider_id: string | null;
        model_id: string | null;
        prompt_tokens: number;
        completion_tokens: number;
        calls: number;
      }>;

      const byModel: UsageByModel[] = modelRows.map((r) => {
        const promptTokens = Number(r.prompt_tokens) || 0;
        const completionTokens = Number(r.completion_tokens) || 0;
        const rate = resolveModelPricing(r.model_id, pricing);
        return {
          providerId: r.provider_id,
          modelId: r.model_id,
          promptTokens,
          completionTokens,
          calls: Number(r.calls) || 0,
          estimatedCostUsd: estimateCostUsd(promptTokens, completionTokens, rate),
        };
      });

      const sessionRows = db
        .prepare(
          `
          SELECT
            m.session_id AS session_id,
            s.title AS title,
            COALESCE(SUM(m.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) AS completion_tokens,
            COUNT(*) AS calls
          FROM messages m
          LEFT JOIN sessions s ON s.id = m.session_id
          WHERE m.role = 'assistant'
            AND (m.prompt_tokens IS NOT NULL OR m.completion_tokens IS NOT NULL)
            ${sinceClause}
          GROUP BY m.session_id
          ORDER BY (prompt_tokens + completion_tokens) DESC
          LIMIT ?
          `,
        )
        .all(...sinceParams, sessionLimit) as Array<{
        session_id: string;
        title: string | null;
        prompt_tokens: number;
        completion_tokens: number;
        calls: number;
      }>;

      const sessionModelRows = db
        .prepare(
          `
          SELECT
            m.session_id AS session_id,
            m.model_id AS model_id,
            COALESCE(SUM(m.prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(m.completion_tokens), 0) AS completion_tokens
          FROM messages m
          WHERE m.role = 'assistant'
            AND (m.prompt_tokens IS NOT NULL OR m.completion_tokens IS NOT NULL)
            ${sinceClause}
          GROUP BY m.session_id, m.model_id
          `,
        )
        .all(...sinceParams) as Array<{
        session_id: string;
        model_id: string | null;
        prompt_tokens: number;
        completion_tokens: number;
      }>;

      const sessionCost = new Map<string, number>();
      for (const row of sessionModelRows) {
        const rate = resolveModelPricing(row.model_id, pricing);
        const part = estimateCostUsd(
          Number(row.prompt_tokens) || 0,
          Number(row.completion_tokens) || 0,
          rate,
        );
        if (part == null) continue;
        sessionCost.set(row.session_id, (sessionCost.get(row.session_id) ?? 0) + part);
      }

      const bySession: UsageBySession[] = sessionRows.map((r) => ({
        sessionId: r.session_id,
        title: r.title,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        calls: Number(r.calls) || 0,
        estimatedCostUsd: sessionCost.has(r.session_id) ? (sessionCost.get(r.session_id) as number) : null,
      }));

      const totalPromptTokens = byModel.reduce((a, r) => a + r.promptTokens, 0);
      const totalCompletionTokens = byModel.reduce((a, r) => a + r.completionTokens, 0);
      const totalCalls = byModel.reduce((a, r) => a + r.calls, 0);

      let estimatedCostUsd: number | null = null;
      for (const row of byModel) {
        if (row.estimatedCostUsd == null) continue;
        estimatedCostUsd = (estimatedCostUsd ?? 0) + row.estimatedCostUsd;
      }
      if (byModel.length === 0) estimatedCostUsd = 0;

      return {
        since,
        until,
        totalPromptTokens,
        totalCompletionTokens,
        totalCalls,
        estimatedCostUsd,
        byModel,
        bySession,
        pricing,
      };
    },
  };
}

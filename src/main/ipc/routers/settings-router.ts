import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { createAppSettingsStore } from '../../store/app-settings-store.js';
import {
  parseToolAllowlist,
  parseToolApprovalMode,
  TOOL_ALLOWLIST_SETTING_KEY,
  TOOL_APPROVAL_SETTING_KEY,
} from '../../orchestrator/tool-approval.js';
import { BUDGET_SETTING_KEY, readBudgetConfig } from '../../store/usage-store.js';

const t = initTRPC.create({ isServer: true });

const TOOL_KEY_NAMES = ['brave_api_key', 'tavily_api_key'] as const;
type ToolKeyName = (typeof TOOL_KEY_NAMES)[number];

function db(): Database.Database {
  const d = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!d) throw new Error('database not available');
  return d;
}

export const settingsRouter = t.router({
  /**
   * Returns whether each tool key is configured. Never returns the actual
   * secret value to the renderer (defence-in-depth — they're not encrypted
   * at rest like provider secrets, but we still avoid exposing them over IPC).
   */
  getToolKeys: t.procedure.query(() => {
    const store = createAppSettingsStore(db());
    const out: Record<string, { set: boolean }> = {};
    for (const k of TOOL_KEY_NAMES) {
      const v = store.getSetting(k);
      out[k] = { set: !!v && v.length > 0 };
    }
    return out as { [K in ToolKeyName]: { set: boolean } };
  }),

  setToolKey: t.procedure
    .input(
      z.object({
        key: z.enum(TOOL_KEY_NAMES),
        value: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const store = createAppSettingsStore(db());
      const trimmed = input.value.trim();
      if (trimmed.length === 0) {
        store.deleteSetting(input.key);
      } else {
        store.setSetting(input.key, trimmed);
      }
      return { ok: true };
    }),

  getToolApprovalMode: t.procedure.query(() => {
    const raw = createAppSettingsStore(db()).getSetting(TOOL_APPROVAL_SETTING_KEY);
    return { mode: parseToolApprovalMode(raw) };
  }),

  setToolApprovalMode: t.procedure
    .input(z.object({ mode: z.enum(['off', 'ask']) }))
    .mutation(({ input }) => {
      createAppSettingsStore(db()).setSetting(TOOL_APPROVAL_SETTING_KEY, input.mode);
      return { ok: true as const };
    }),

  getToolAllowlist: t.procedure.query(() => {
    const raw = createAppSettingsStore(db()).getSetting(TOOL_ALLOWLIST_SETTING_KEY);
    return { tools: parseToolAllowlist(raw) };
  }),

  setToolAllowlist: t.procedure
    .input(z.object({ tools: z.array(z.string().min(1).max(200)).max(200) }))
    .mutation(({ input }) => {
      const tools = [...new Set(input.tools.map((s) => s.trim()).filter(Boolean))];
      createAppSettingsStore(db()).setSetting(TOOL_ALLOWLIST_SETTING_KEY, JSON.stringify(tools));
      return { ok: true as const, tools };
    }),

  getUsageBudget: t.procedure.query(() => readBudgetConfig(db())),

  setUsageBudget: t.procedure
    .input(
      z.object({
        enabled: z.boolean(),
        maxUsd: z.number().finite().min(0).nullable(),
        periodDays: z.number().int().positive().max(3650).default(30),
        sessionMaxUsd: z.number().finite().min(0).nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      createAppSettingsStore(db()).setSetting(
        BUDGET_SETTING_KEY,
        JSON.stringify({
          enabled: input.enabled,
          maxUsd: input.maxUsd,
          periodDays: input.periodDays,
          sessionMaxUsd: input.sessionMaxUsd ?? null,
        }),
      );
      return { ok: true as const };
    }),
});

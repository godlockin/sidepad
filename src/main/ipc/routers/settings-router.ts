import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { createAppSettingsStore } from '../../store/app-settings-store.js';

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
});

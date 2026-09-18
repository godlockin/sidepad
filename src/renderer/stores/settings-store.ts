import { create } from 'zustand';
import { trpc } from '../lib/trpc-client';
import type { Theme } from '../lib/theme';

const THEME_KEY = 'sidepad-theme';

function loadTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'system';
  } catch {
    return 'system';
  }
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

interface SettingsState {
  theme: Theme;
  providers: Array<{ id: string; configId: string; iconKind: 'emoji' | 'image' | null; iconValue: string | null }>;
  /** Total rows in provider_configs (DB truth), incl. ones the registry skipped. */
  configuredTotal: number;
  loaded: boolean;

  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  addProvider: (config: {
    id: string;
    type: string;
    apiKey: string;
    baseURL?: string;
    defaultModel?: string;
    extraHeaders?: Record<string, string>;
    extraBody?: Record<string, unknown>;
    modelOverrides?: Record<string, Record<string, unknown>>;
  }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setProviderIcon: (configId: string, kind: 'emoji' | 'image' | null, value: string | null) => Promise<void>;
  refreshProviders: () => Promise<void>;
  set: (partial: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: loadTheme(),
  providers: [],
  configuredTotal: 0,
  loaded: false,

  init: async () => {
    await get().refreshProviders();
    set({ loaded: true });
  },

  setTheme: (theme: Theme) => {
    saveTheme(theme);
    set({ theme });
  },

  addProvider: async (config) => {
    await trpc.provider.configure.mutate({
      id: config.id,
      type: config.type as any,
      // empty string = keep existing key (edit mode); only send if non-empty
      apiKey: config.apiKey || undefined,
      baseURL: config.baseURL,
      defaultModel: config.defaultModel,
      extraHeaders: config.extraHeaders,
      extraBody: config.extraBody,
      modelOverrides: config.modelOverrides,
    });
    await get().refreshProviders();
  },

  deleteProvider: async (id: string) => {
    await trpc.provider.remove.mutate({ id });
    await get().refreshProviders();
  },

  setProviderIcon: async (configId, kind, value) => {
    await trpc.provider.setIcon.mutate({ configId, kind, value });
    await get().refreshProviders();
  },

  refreshProviders: async () => {
    try {
      const providers = await trpc.provider.list.query();
      set({ providers });
    } catch {
      set({ providers: [] });
    }
    // DB truth: count all configured rows, even those the registry skipped
    // (e.g. API key missing/unreadable). Best-effort only.
    try {
      const configured = await trpc.provider.listConfigured.query();
      set({ configuredTotal: configured.length });
    } catch {
      // Query failed — keep the previous count rather than hiding the notice.
    }
  },

  set: (partial) => set(partial),
}));

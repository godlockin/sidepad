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
  loaded: boolean;

  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  addProvider: (config: { id: string; type: string; apiKey: string; baseURL?: string; defaultModel?: string }) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setProviderIcon: (configId: string, kind: 'emoji' | 'image' | null, value: string | null) => Promise<void>;
  refreshProviders: () => Promise<void>;
  set: (partial: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: loadTheme(),
  providers: [],
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
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      defaultModel: config.defaultModel,
    });
    await get().refreshProviders();
  },

  deleteProvider: async (id: string) => {
    // No delete endpoint yet — disable by reconfiguring with enabled=false
    // For now, just refresh
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
  },

  set: (partial) => set(partial),
}));

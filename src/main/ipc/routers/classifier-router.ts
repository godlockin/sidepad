import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { ClassifierAgent } from '../../orchestrator/classifier.js';
import type { ClassifierConfig } from '../../orchestrator/classifier.js';
import type { LLMProvider } from '../../providers/types.js';
import { registry } from '../../providers/index.js';
import { createAppSettingsStore } from '../../store/app-settings-store.js';

const t = initTRPC.create({ isServer: true });

const CLASSIFIER_SETTING_KEY = 'classifier_config';

let classifierConfig: ClassifierConfig | null = null;
let classifierAgent: ClassifierAgent | null = null;
let loadedFromDb = false;

function db(): Database.Database | undefined {
  return (globalThis as any).sidepad?.db as Database.Database | undefined;
}

function defaultConfig(): ClassifierConfig {
  return {
    enabled: false,
    providerId: '',
    model: '',
    timeoutMs: 8_000,
    threshold: 0.6,
  };
}

function persist(config: ClassifierConfig): void {
  const d = db();
  if (!d) return;
  createAppSettingsStore(d).setSetting(CLASSIFIER_SETTING_KEY, JSON.stringify(config));
}

function loadFromDb(): void {
  if (loadedFromDb) return;
  loadedFromDb = true;
  const d = db();
  if (!d) {
    classifierConfig = defaultConfig();
    return;
  }
  try {
    const raw = createAppSettingsStore(d).getSetting(CLASSIFIER_SETTING_KEY);
    if (!raw) {
      classifierConfig = defaultConfig();
      return;
    }
    const parsed = JSON.parse(raw) as Partial<ClassifierConfig>;
    classifierConfig = {
      enabled: !!parsed.enabled,
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      timeoutMs:
        typeof parsed.timeoutMs === 'number' && parsed.timeoutMs > 0
          ? Math.min(60_000, Math.floor(parsed.timeoutMs))
          : 8_000,
      threshold:
        typeof parsed.threshold === 'number' && parsed.threshold >= 0 && parsed.threshold <= 1
          ? parsed.threshold
          : 0.6,
    };
  } catch {
    classifierConfig = defaultConfig();
  }
}

function rebuildAgent(): ClassifierAgent | null {
  loadFromDb();
  if (!classifierConfig?.enabled || !classifierConfig.providerId || !classifierConfig.model) {
    classifierAgent = null;
    return null;
  }
  let provider: LLMProvider | null = null;
  try {
    provider = registry.has(classifierConfig.providerId)
      ? registry.get(classifierConfig.providerId)
      : null;
  } catch {
    provider = null;
  }
  if (!provider) {
    classifierAgent = null;
    return null;
  }
  classifierAgent = new ClassifierAgent(classifierConfig, provider);
  return classifierAgent;
}

/** Used by chat-router to inject into the orchestrator. */
export function getClassifierAgent(): ClassifierAgent | null {
  if (classifierAgent) return classifierAgent;
  return rebuildAgent();
}

export function getClassifierThreshold(): number {
  loadFromDb();
  return classifierConfig?.threshold ?? 0.6;
}

export const classifierRouter = t.router({
  classify: t.procedure
    .input(
      z.object({
        text: z.string(),
        mentions: z.array(
          z.object({
            agentId: z.string(),
            displayName: z.string(),
            role: z.string(),
          }),
        ),
        triggerHints: z.object({
          leadMatched: z.boolean(),
          commentMatched: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const agent = getClassifierAgent();
      if (!agent) {
        return { mode: 'parallel' as const, confidence: 0 };
      }
      return agent.classify(input);
    }),

  configure: t.procedure
    .input(
      z.object({
        enabled: z.boolean(),
        providerId: z.string(),
        model: z.string(),
        timeoutMs: z.number().int().positive().max(60_000).default(8_000),
        threshold: z.number().min(0).max(1).default(0.6),
      }),
    )
    .mutation(({ input }) => {
      classifierConfig = {
        enabled: input.enabled,
        providerId: input.providerId,
        model: input.model,
        timeoutMs: input.timeoutMs,
        threshold: input.threshold,
      };
      persist(classifierConfig);
      classifierAgent = null;
      rebuildAgent();
      return { ok: true as const };
    }),

  getConfig: t.procedure.query(() => {
    loadFromDb();
    return classifierConfig ?? defaultConfig();
  }),

  status: t.procedure.query(() => {
    const agent = getClassifierAgent();
    loadFromDb();
    return {
      enabled: agent?.isEnabled() ?? false,
      configured: !!(classifierConfig?.providerId && classifierConfig?.model),
      threshold: classifierConfig?.threshold ?? 0.6,
    };
  }),
});

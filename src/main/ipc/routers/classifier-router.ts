import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { ClassifierAgent } from '../../orchestrator/classifier.js';
import type { ClassifierConfig } from '../../orchestrator/classifier.js';
import type { LLMProvider } from '../../providers/types.js';
import { registry } from '../../providers/index.js';

const t = initTRPC.create({ isServer: true });

// In-memory classifier config (Phase 2: persists to DB via params_json when available)
let classifierConfig: ClassifierConfig | null = null;
let classifierAgent: ClassifierAgent | null = null;

function getClassifier(): ClassifierAgent | null {
  if (classifierAgent) return classifierAgent;
  if (!classifierConfig) return null;

  // Get the provider for the classifier
  let provider: LLMProvider | null = null;
  try {
    provider = registry.get(classifierConfig.providerId);
  } catch {
    // provider not registered
  }

  if (!provider) return null;

  classifierAgent = new ClassifierAgent(classifierConfig, provider);
  return classifierAgent;
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
      const agent = getClassifier();
      if (!agent) {
        // Fall back to a default result based on simple heuristics
        return {
          mode: 'parallel' as const,
          confidence: 0,
        };
      }
      return agent.classify(input);
    }),

  configure: t.procedure
    .input(
      z.object({
        enabled: z.boolean(),
        providerId: z.string(),
        model: z.string(),
        timeoutMs: z.number(),
        threshold: z.number(),
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

      // Reset singleton so next getClassifier reads fresh config
      classifierAgent = null;

      return { ok: true };
    }),

  status: t.procedure.query(() => {
    const agent = getClassifier();
    return { enabled: agent?.isEnabled() ?? false };
  }),
});

/**
 * Effort planner — the framework's "auto" brain for per-call parameter
 * planning.
 *
 * For every model call it estimates the task tier from the user's turn and
 * derives a ReasoningEffort for thinking-capable models, so easy turns stop
 * paying for deep thinking while hard turns get a bigger budget. It also
 * powers model-variety routing: when a session's default voice is the
 * '__auto__' sentinel, the planner picks which participant should answer.
 *
 * V1 is deliberately conservative:
 *   - non-reasoning models are never touched (no parameter injection)
 *   - 'standard' tier calls get no override (provider default behavior)
 *   - explicit @-mentions always win over auto model selection
 */
import type { ProviderCapabilities, ReasoningEffort } from '../providers/types';

export const AUTO_AGENT_ID = '__auto__';

export type TaskTier = 'light' | 'standard' | 'deep';

const deepZh = /为什么|什么原理|原理是|分析一下|设计一个|设计方案|架构|推理|逐步|一步一步|证明|推导|权衡|对比评估|利弊|复盘|调试|排查|根因|优化|重构|规划/;
const deepEn =
  /\bwhy\b|\banalyze\b|\bdesign\b|\barchitect\b|\bderive\b|\bprove\b|\btrade-?offs?\b|\bpros\s+and\s+cons\b|\bstep[- ]by[- ]step\b|\bdebug\b|\broot\s+cause\b|\brefactor\b|\boptimize\b|\bplan\b/i;
const lightEn = /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|great|nice|cool)[\s!.?]*$/i;
const lightZh = /^(你好|您好|嗨|哈喽|在吗|谢谢|多谢|辛苦了|好的|收到|明白|ok|ok啦)[\s！。？]*$/;
const pureArithmetic = /^[\d\s+\-*/×÷=().,%?？]+$/;

/** Classify the user's turn into a task tier. */
export function estimateTier(text: string): TaskTier {
  const t = (text ?? '').trim();
  if (!t) return 'light';
  if (pureArithmetic.test(t)) return 'light';
  if (t.length <= 16 && (lightEn.test(t) || lightZh.test(t))) return 'light';
  if (/```/.test(t) || t.length > 1200 || deepZh.test(t) || deepEn.test(t)) return 'deep';
  return 'standard';
}

/**
 * Decide the reasoning effort for one call.
 * Returns null when the provider default should be kept untouched
 * (non-reasoning models, standard-tier turns).
 */
export function planEffort(text: string, caps?: ProviderCapabilities): ReasoningEffort | null {
  if (!caps?.reasoning) return null;
  switch (estimateTier(text)) {
    case 'light':
      return 'minimal';
    case 'deep':
      return 'high';
    default:
      return null;
  }
}

export interface AgentCandidate {
  agentId: string;
  model: string;
  caps?: ProviderCapabilities;
}

/**
 * Pick which agent instance should answer when the session is in auto
 * routing. Stability matters more than cleverness: candidates keep their
 * session order and ties resolve to the earliest.
 *   - deep turns prefer reasoning-capable models
 *   - light turns prefer cheap/fast models
 *   - standard turns take the first candidate
 */
export function pickAgentId(candidates: AgentCandidate[], tier: TaskTier): string | null {
  if (candidates.length === 0) return null;
  const capsOf = (c: AgentCandidate) => c.caps ?? {};
  if (tier === 'deep') {
    const reasoning = candidates.find((c) => capsOf(c).reasoning);
    if (reasoning) return reasoning.agentId;
  }
  if (tier === 'light') {
    // Thinking models are the expensive ones — prefer any non-reasoning
    // candidate for greetings/acks/pure arithmetic.
    const cheap = candidates.find((c) => !capsOf(c).reasoning);
    if (cheap) return cheap.agentId;
  }
  return candidates[0].agentId;
}

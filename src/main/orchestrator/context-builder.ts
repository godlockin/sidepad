import type { ChatRequest } from '../providers/types';
import { truncateContext, estimateTokens } from './truncate';

export function buildContext(input: {
  history: Array<{ role: 'user' | 'assistant'; content: string; agentId: string }>;
  agentId: string;
  visibilityMode: 'independent' | 'full';
  systemPrompt: string | null;
  currentTurn: ChatRequest['messages'];
  modelContextWindow: number;
}): ChatRequest {
  const { history, agentId, visibilityMode, systemPrompt, currentTurn, modelContextWindow } = input;
  const threshold = modelContextWindow * 0.85;

  const selected = visibilityMode === 'independent'
    ? history.filter(m => m.agentId === agentId)
    : history;

  const messages: ChatRequest['messages'] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push(...selected.map(m => ({ role: m.role, content: m.content })));
  messages.push(...currentTurn);

  return truncateContext(messages, threshold, modelContextWindow);
}

import type { ChatRequest } from '../providers/types';

export function estimateTokens(text: string): number {
  let ascii = 0, cjk = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk++;
    else ascii++;
  }
  return Math.ceil(ascii / 4) + Math.ceil(cjk / 1.5);
}

export function truncateContext(
  messages: ChatRequest['messages'],
  thresholdTokens: number,
  _modelContextWindow: number,
): { messages: ChatRequest['messages']; droppedTurns: number } {
  const total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (total <= thresholdTokens) return { messages, droppedTurns: 0 };

  const systemMsg = messages.filter(m => m.role === 'system');
  const currentUserTurns = messages.filter(m => m.role === 'user').slice(-2);
  const pairs = messages.filter(m => m.role !== 'system');

  let dropped = 0;
  while (pairs.length > 2) {
    pairs.shift();
    dropped++;
    const remaining = [...systemMsg, ...pairs, ...currentUserTurns];
    const remainingTokens = remaining.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (remainingTokens <= thresholdTokens) break;
  }

  return { messages: [...systemMsg, ...pairs, ...currentUserTurns], droppedTurns: dropped };
}

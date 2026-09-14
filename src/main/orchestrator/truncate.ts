import type { ChatRequest } from '../providers/types';

export function estimateTokens(text: string): number {
  let ascii = 0, cjk = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk++;
    else ascii++;
  }
  return Math.ceil(ascii / 4) + Math.ceil(cjk / 1.5);
}

/** Indices of the two most recent user messages — these are never dropped. */
function pinnedIndices(body: ChatRequest['messages']): Set<number> {
  const pinned = new Set<number>();
  for (let i = body.length - 1; i >= 0 && pinned.size < 2; i--) {
    if (body[i].role === 'user') pinned.add(i);
  }
  return pinned;
}

/**
 * Trim history to the token budget: drop oldest non-pinned messages while
 * over threshold, preserving chronological order. The system prompt and the
 * two most recent user turns always survive, and no message is duplicated.
 */
export function truncateContext(
  messages: ChatRequest['messages'],
  thresholdTokens: number,
  _modelContextWindow: number,
): { messages: ChatRequest['messages']; droppedTurns: number } {
  const systemMsg = messages.filter(m => m.role === 'system');
  const body = messages.filter(m => m.role !== 'system');

  const systemTotal = systemMsg.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  let bodyTotal = body.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (systemTotal + bodyTotal <= thresholdTokens) return { messages, droppedTurns: 0 };

  let dropped = 0;
  while (body.length > 0 && systemTotal + bodyTotal > thresholdTokens) {
    const pinned = pinnedIndices(body);
    const idx = body.findIndex((_, i) => !pinned.has(i));
    if (idx === -1) break; // nothing left except the pinned user turns
    bodyTotal -= estimateTokens(body[idx].content);
    body.splice(idx, 1);
    dropped++;
  }

  return { messages: [...systemMsg, ...body], droppedTurns: dropped };
}

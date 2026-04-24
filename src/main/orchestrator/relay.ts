import type { LLMProvider, ChatRequest } from '../providers/types';
import type { OrchestratorEvent } from './types';

export async function* runRelay(
  sessionId: string,
  turnId: string,
  agentIds: string[],
  text: string,
  systemPrompt: string | null,
  visibilityMode: 'independent' | 'full',
  modelContextWindow: number,
  getProviderForAgent: (agentId: string) => LLMProvider,
  getModelForAgent: (agentId: string) => string,
): AsyncIterable<OrchestratorEvent> {
  const successfulOutputs = new Map<string, string>();

  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    const provider = getProviderForAgent(agentId);
    const model = getModelForAgent(agentId);

    const contextMessages: ChatRequest['messages'] = [];
    if (systemPrompt) contextMessages.push({ role: 'system', content: systemPrompt });

    // Add successful previous outputs
    for (let j = 0; j < i; j++) {
      const prevAgent = agentIds[j];
      const output = successfulOutputs.get(prevAgent);
      if (output) contextMessages.push({ role: 'assistant', content: output, name: prevAgent });
    }

    // Add current user turn
    contextMessages.push({ role: 'user', content: text });

    try {
      const stream = provider.chat({ model, messages: contextMessages }, new AbortController().signal);

      let content = '';
      for await (const chunk of stream) {
        if (chunk.delta) {
          content += chunk.delta;
          yield { type: 'message:delta', turnId, msgId: '', agentId, delta: chunk.delta };
        }
        if (chunk.finishReason) {
          yield {
            type: 'message:finish',
            turnId,
            msgId: '',
            agentId,
            finishReason: chunk.finishReason,
            usage: chunk.usage,
          };
          if (chunk.finishReason === 'stop') {
            successfulOutputs.set(agentId, content);
          }
        }
      }
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? (err as any).code : 'UNKNOWN';
      yield {
        type: 'message:error',
        turnId,
        msgId: '',
        agentId,
        code,
        message: err instanceof Error ? err.message : String(err),
        retriable: false,
      };
    }
  }

  yield { type: 'turn:complete', turnId };
}

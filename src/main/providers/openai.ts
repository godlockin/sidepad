import OpenAI from 'openai';
import type { LLMProvider, ChatRequest, ChatChunk, Model } from './types';
import { normalizeError } from './errors';

export class OpenAIProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  private client: OpenAI;

  constructor(id: string, configId: string, apiKey: string, baseURL?: string) {
    this.id = id;
    this.configId = configId;
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map(m => ({ id: m.id, name: m.id, contextWindow: this.estimateContextWindow(m.id) }));
    } catch {
      return [];
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const messages = req.systemPrompt
      ? [{ role: 'system' as const, content: req.systemPrompt }, ...req.messages]
      : req.messages;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: req.model,
          messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
        },
        { signal },
      );
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          yield { delta: choice.delta.content };
        }
        if (choice.finish_reason) {
          const usage = chunk.usage
            ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
            : undefined;
          yield {
            finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason === 'length' ? 'length' : 'error',
            usage,
          };
        }
      }
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  private estimateContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 128_000;
    if (modelId.includes('gpt-4-turbo')) return 128_000;
    if (modelId.includes('gpt-4')) return 8_192;
    if (modelId.includes('gpt-3.5-turbo')) return 16_385;
    return 8_192;
  }
}

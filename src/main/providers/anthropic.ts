import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatRequest, ChatChunk, Model } from './types';
import { normalizeError } from './errors';

export class AnthropicProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  private client: Anthropic;

  constructor(id: string, configId: string, apiKey: string) {
    this.id = id;
    this.configId = configId;
    this.client = new Anthropic({ apiKey });
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: (m as any)?.metadata?.context_window_size ?? 200_000,
      }));
    } catch {
      return [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200_000 },
        { id: 'claude-opus-4-0', name: 'Claude Opus 4', contextWindow: 200_000 },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200_000 },
      ];
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const messages = req.messages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }));
    try {
      const stream = await this.client.messages.stream(
        {
          model: req.model,
          messages,
          system: req.systemPrompt,
          temperature: req.temperature,
          max_tokens: req.maxTokens ?? 4096,
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield { delta: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      const usage = final.usage
        ? { promptTokens: final.usage.input_tokens, completionTokens: final.usage.output_tokens }
        : undefined;
      yield {
        finishReason:
          final.stop_reason === 'end_turn'
            ? 'stop'
            : final.stop_reason === 'max_tokens'
              ? 'length'
              : 'error',
        usage,
      };
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }
}

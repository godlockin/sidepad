import ollamaDefault, { Ollama } from 'ollama';
import type { LLMProvider, ChatRequest, ChatChunk, Model } from './types';
import { normalizeError } from './errors';

export class OllamaProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  private readonly client: Ollama;

  constructor(id: string, configId: string, baseURL?: string) {
    this.id = id;
    this.configId = configId;
    this.client = baseURL ? new Ollama({ host: baseURL }) : (ollamaDefault as unknown as Ollama);
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.client.list();
      return res.models.map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: this.estimateContextWindow(m.name),
      }));
    } catch {
      return [];
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    try {
      const response = await this.client.chat({
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: { temperature: req.temperature, num_predict: req.maxTokens },
      });
      for await (const part of response) {
        if (signal.aborted) break;
        if (part.message?.content) yield { delta: part.message.content };
        if (part.done)
          yield {
            finishReason: 'stop',
            usage: { promptTokens: part.prompt_eval_count ?? 0, completionTokens: part.eval_count ?? 0 },
          };
      }
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  private estimateContextWindow(n: string): number {
    if (n.includes('llama3') || n.includes('llama-3')) return 8_192;
    if (n.includes('mistral')) return 32_768;
    return 4_096;
  }
}

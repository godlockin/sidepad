import ollamaDefault, { Ollama } from 'ollama';
import type {
  LLMProvider,
  ChatRequest,
  ChatChunk,
  Model,
  ChatMessage,
  ToolCall,
} from './types';
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
    const messages = (req.messages as ChatMessage[]).map((m) => {
      if (m.role === 'tool') {
        // Ollama expects tool replies as role:'tool' with content (no id concept).
        return { role: 'tool', content: m.content } as any;
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        return {
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments ?? {} },
          })),
        } as any;
      }
      return { role: m.role, content: m.content };
    });

    const tools =
      req.tools && req.tools.length
        ? req.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as any,
            },
          }))
        : undefined;

    const baseArgs: any = {
      model: req.model,
      messages,
      stream: true,
      options: { temperature: req.temperature, num_predict: req.maxTokens },
    };

    let response: any;
    try {
      response = await this.client.chat(tools ? { ...baseArgs, tools } : baseArgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (tools && /unsupported|does not support|tool/i.test(msg)) {
        // Fallback: model lacks tool support — retry without tools.
        // eslint-disable-next-line no-console
        console.warn(`[ollama] model ${req.model} does not support tools; falling back to text-only`);
        try {
          response = await this.client.chat(baseArgs);
        } catch (err2) {
          const n = normalizeError(err2);
          if (n.code === 'ABORTED') return;
          throw n;
        }
      } else {
        const n = normalizeError(err);
        if (n.code === 'ABORTED') return;
        throw n;
      }
    }

    try {
      const collectedToolCalls: ToolCall[] = [];
      for await (const part of response) {
        if (signal.aborted) break;
        if (part.message?.content) yield { delta: part.message.content };
        const tc = part.message?.tool_calls as Array<any> | undefined;
        if (tc && tc.length) {
          for (let i = 0; i < tc.length; i++) {
            const c = tc[i];
            const argsObj =
              typeof c.function?.arguments === 'string'
                ? safeParse(c.function.arguments)
                : (c.function?.arguments ?? {});
            collectedToolCalls.push({
              id: c.id ?? `call_${collectedToolCalls.length}`,
              name: c.function?.name ?? '',
              arguments: argsObj,
            });
          }
        }
        if (part.done) {
          const finishReason: ChatChunk['finishReason'] =
            collectedToolCalls.length > 0 ? 'tool_calls' : 'stop';
          yield {
            finishReason,
            usage: { promptTokens: part.prompt_eval_count ?? 0, completionTokens: part.eval_count ?? 0 },
            ...(collectedToolCalls.length ? { toolCalls: collectedToolCalls } : {}),
          };
        }
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

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

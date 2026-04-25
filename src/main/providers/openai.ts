import OpenAI from 'openai';
import type {
  LLMProvider,
  ChatRequest,
  ChatChunk,
  Model,
  ChatMessage,
  ToolCall,
  ProviderCapabilities,
} from './types';
import { normalizeError } from './errors';

export class OpenAIProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  protected client: OpenAI;

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
    const messages = toOpenAIMessages(req);

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

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: messages as any,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
          ...(tools ? { tools } : {}),
        },
        { signal },
      );

      // Buffer for streamed tool_call argument fragments, keyed by tool_call index
      const toolBuf = new Map<number, { id: string; name: string; argText: string }>();

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          yield { delta: choice.delta.content };
        }
        const rDelta = (choice.delta as any)?.reasoning_content ?? (choice.delta as any)?.reasoning;
        if (typeof rDelta === 'string' && rDelta.length > 0) {
          yield { reasoningDelta: rDelta };
        }
        const tcDeltas = (choice.delta as any)?.tool_calls as Array<any> | undefined;
        if (tcDeltas) {
          for (const td of tcDeltas) {
            const idx = typeof td.index === 'number' ? td.index : 0;
            let buf = toolBuf.get(idx);
            if (!buf) {
              buf = { id: td.id ?? '', name: td.function?.name ?? '', argText: '' };
              toolBuf.set(idx, buf);
            }
            if (td.id) buf.id = td.id;
            if (td.function?.name) buf.name = td.function.name;
            if (typeof td.function?.arguments === 'string') buf.argText += td.function.arguments;
          }
        }
        if (choice.finish_reason) {
          const usage = chunk.usage
            ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
            : undefined;
          let toolCalls: ToolCall[] | undefined;
          if (choice.finish_reason === 'tool_calls' && toolBuf.size > 0) {
            toolCalls = [];
            const indices = Array.from(toolBuf.keys()).sort((a, b) => a - b);
            for (const i of indices) {
              const b = toolBuf.get(i)!;
              let parsed: Record<string, unknown> = {};
              try {
                parsed = b.argText ? JSON.parse(b.argText) : {};
              } catch {
                parsed = { _raw: b.argText };
              }
              toolCalls.push({ id: b.id || `call_${i}`, name: b.name, arguments: parsed });
            }
          }
          const finishReason: ChatChunk['finishReason'] =
            choice.finish_reason === 'stop'
              ? 'stop'
              : choice.finish_reason === 'length'
                ? 'length'
                : choice.finish_reason === 'tool_calls'
                  ? 'tool_calls'
                  : 'error';
          yield {
            finishReason,
            usage,
            ...(toolCalls ? { toolCalls } : {}),
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

  capabilities(model: string): ProviderCapabilities {
    return {
      vision: /(gpt-4o|gpt-4-turbo|gpt-4-vision|o1|o3|o4)/i.test(model),
      tools: true,
    };
  }
}

/**
 * Convert sidepad ChatMessage[] to OpenAI message format, including
 * assistant.tool_calls and role:'tool' (tool_call_id) mappings, plus an
 * optional system prefix from req.systemPrompt.
 */
export function toOpenAIMessages(req: ChatRequest): any[] {
  const out: any[] = [];
  if (req.systemPrompt) out.push({ role: 'system', content: req.systemPrompt });
  for (const m of req.messages as ChatMessage[]) {
    if (m.role === 'assistant') {
      const tc = m.toolCalls;
      if (tc && tc.length) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: tc.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
          })),
        });
      } else {
        out.push({ role: 'assistant', content: m.content, ...(m.name ? { name: m.name } : {}) });
      }
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else {
      const userImgs = (m as any).images as Array<{ mime: string; base64: string }> | undefined;
      if (userImgs && userImgs.length) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const img of userImgs) {
          blocks.push({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          });
        }
        out.push({ role: 'user', content: blocks, ...(m.name ? { name: m.name } : {}) });
      } else {
        out.push({ role: 'user', content: m.content, ...(m.name ? { name: m.name } : {}) });
      }
    }
  }
  return out;
}

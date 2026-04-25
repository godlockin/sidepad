import OpenAI, { AzureOpenAI } from 'openai';
import { OpenAIProvider, toOpenAIMessages } from './openai';
import type { ChatRequest, ChatChunk, ToolCall, ProviderCapabilities } from './types';
import { normalizeError } from './errors';

/**
 * OpenAI-compatible provider.
 *
 * If `baseURL` looks like an Azure endpoint (`*.openai.azure.com`), uses the
 * AzureOpenAI client which speaks Azure's URL convention
 * (`/openai/deployments/{deployment}/chat/completions?api-version=...`) and
 * `api-key` header. The configured model name is the deployment id.
 *
 * Otherwise behaves as a thin pass-through to OpenAI's REST surface.
 */
export class OpenAICompatProvider extends OpenAIProvider {
  private azureClient: AzureOpenAI | null = null;

  constructor(id: string, configId: string, apiKey: string, baseURL: string) {
    super(id, configId, apiKey, baseURL);
    if (/\.openai\.azure\.com/i.test(baseURL)) {
      // strip trailing slash and any /openai suffix
      const endpoint = baseURL.replace(/\/$/, '').replace(/\/openai$/i, '');
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
      this.azureClient = new AzureOpenAI({ endpoint, apiKey, apiVersion });
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    if (!this.azureClient) {
      yield* super.chat(req, signal);
      return;
    }
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
      const stream = await this.azureClient.chat.completions.create(
        {
          model: req.model, // = deployment name on Azure
          messages: messages as any,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
          ...(tools ? { tools } : {}),
        },
        { signal },
      );
      const toolBuf = new Map<number, { id: string; name: string; argText: string }>();
      for await (const chunk of stream as any) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { delta: choice.delta.content };
        const rDelta = (choice.delta as any)?.reasoning_content ?? (choice.delta as any)?.reasoning;
        if (typeof rDelta === 'string' && rDelta.length > 0) {
          yield { reasoningDelta: rDelta };
        }
        const tcDeltas = choice.delta?.tool_calls as Array<any> | undefined;
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

  capabilities(model: string): ProviderCapabilities {
    return {
      vision: /(gpt-4o|qwen.*vl|qwen2.*vl|qwen3.*vl|deepseek.*vl|glm.*v|yi.*vl)/i.test(model),
      tools: true,
    };
  }
}

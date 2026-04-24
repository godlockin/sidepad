import OpenAI, { AzureOpenAI } from 'openai';
import { OpenAIProvider } from './openai';
import type { ChatRequest, ChatChunk } from './types';
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
    const messages = (req as any).systemPrompt
      ? [{ role: 'system' as const, content: (req as any).systemPrompt }, ...req.messages]
      : req.messages;
    try {
      const stream = await this.azureClient.chat.completions.create(
        {
          model: req.model, // = deployment name on Azure
          messages: messages as any,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
        },
        { signal },
      );
      for await (const chunk of stream as any) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { delta: choice.delta.content };
        if (choice.finish_reason) {
          const usage = chunk.usage
            ? { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens }
            : undefined;
          yield {
            finishReason:
              choice.finish_reason === 'stop'
                ? 'stop'
                : choice.finish_reason === 'length'
                  ? 'length'
                  : 'error',
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
}

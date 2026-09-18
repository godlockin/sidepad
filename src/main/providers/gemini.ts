import { GoogleGenAI } from '@google/genai';
import type { PartListUnion, ToolListUnion } from '@google/genai';
import type {
  LLMProvider,
  ChatRequest,
  ChatChunk,
  Model,
  ChatMessage,
  ToolCall,
  ProviderCapabilities,
  ToolDefinition,
} from './types';
import { normalizeError } from './errors';
import { inferCaps } from './caps-heuristics';
import { mergeOverrides, type ProviderParams } from './overrides';

export class GeminiProvider implements LLMProvider {
  public readonly id: string;
  public readonly configId: string;
  private client: GoogleGenAI;
  private parsedParams: ProviderParams;

  constructor(
    id: string,
    configId: string,
    apiKey: string,
    baseURL?: string,
    parsedParams: ProviderParams = {},
  ) {
    this.id = id;
    this.configId = configId;
    this.client = new GoogleGenAI({
      apiKey,
      ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}),
    });
    this.parsedParams = parsedParams;
  }

  async listModels(): Promise<Model[]> {
    try {
      const pager = await this.client.models.list();
      const models: Model[] = [];
      for await (const m of pager as AsyncIterable<{ name?: string; displayName?: string; inputTokenLimit?: number }>) {
        const id = (m.name ?? '').replace(/^models\//, '');
        if (!id) continue;
        models.push({
          id,
          name: m.displayName ?? id,
          contextWindow: m.inputTokenLimit ?? 1_000_000,
          caps: inferCaps(id),
        });
      }
      return models;
    } catch {
      return [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-pro') },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-flash') },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', contextWindow: 1_000_000, caps: inferCaps('gemini-2.5-flash-lite') },
      ];
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const { headers, body: bodyOverrides } = mergeOverrides(req, this.parsedParams);

    // Translate bodyOverrides.thinkingBudget → thinkingConfig
    const thinkingBudget = (bodyOverrides as Record<string, unknown>).thinkingBudget as number | undefined;
    if (thinkingBudget !== undefined) {
      delete (bodyOverrides as Record<string, unknown>).thinkingBudget;
    }

    const generationConfig: Record<string, unknown> = {
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      ...stripGenericGeminiFields(bodyOverrides),
    };
    if (thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = {
        thinkingBudget,
        includeThoughts: true,
      };
    }

    try {
      const chat = this.client.chats.create({
        model: req.model,
        config: {
          ...(req.systemPrompt ? { systemInstruction: req.systemPrompt } : {}),
          ...generationConfig,
          ...(req.tools?.length ? { tools: toGeminiTools(req.tools) as ToolListUnion } : {}),
          ...(headers ? { httpOptions: { headers } } : {}),
        },
      });

      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) throw new Error('No user message');

      const parts = toGeminiParts(lastUserMsg);
      const stream = await chat.sendMessageStream({
        message: parts,
        config: { abortSignal: signal },
      });

      let finishReason: ChatChunk['finishReason'] | undefined;
      let usage: ChatChunk['usage'] | undefined;
      const toolCalls: ToolCall[] = [];

      for await (const event of stream as AsyncIterable<{
        candidates?: Array<{
          content?: { parts?: Array<Record<string, unknown>> };
          finishReason?: string;
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }>) {
        const cand = event.candidates?.[0];
        if (cand?.content?.parts) {
          for (const p of cand.content.parts) {
            if (p.text) yield { delta: p.text as string };
            if (p.thought) yield { reasoningDelta: '(thinking)' };
            if (p.functionCall) {
              const fc = p.functionCall as { id?: string; name?: string; args?: Record<string, unknown> };
              toolCalls.push({
                id: fc.id ?? `call_${toolCalls.length}`,
                name: fc.name ?? '',
                arguments: fc.args ?? {},
              });
            }
          }
        }
        if (cand?.finishReason) {
          finishReason =
            cand.finishReason === 'STOP' ? 'stop'
            : cand.finishReason === 'MAX_TOKENS' ? 'length'
            : cand.finishReason === 'TOOL_CALL' ? 'tool_calls'
            : 'error';
        }
        if (event.usageMetadata) {
          usage = {
            promptTokens: event.usageMetadata.promptTokenCount ?? 0,
            completionTokens: event.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
      yield {
        ...(finishReason ? { finishReason } : { finishReason: 'stop' }),
        ...(usage ? { usage } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  capabilities(model: string): ProviderCapabilities {
    return {
      vision: /gemini/i.test(model),
      tools: true,
      reasoning: /gemini-2\.5|gemini-3|thinking/i.test(model),
    };
  }
}

function toGeminiParts(msg: ChatMessage): PartListUnion {
  const out: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (msg.content) out.push({ text: msg.content });
  if ((msg as { images?: Array<{ mime: string; base64: string }> }).images?.length) {
    for (const img of (msg as { images: Array<{ mime: string; base64: string }> }).images) {
      out.push({
        inlineData: { mimeType: img.mime, data: img.base64 },
      });
    }
  }
  return out.length ? out as PartListUnion : [{ text: msg.content ?? '' }] as PartListUnion;
}

function toGeminiTools(tools: ToolDefinition[]): unknown[] {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema as Record<string, unknown>,
    })),
  }];
}

function stripGenericGeminiFields(body: Record<string, unknown>): Record<string, unknown> {
  // Only pass fields that are valid in GenerateContentConfig
  const allowed = ['topP', 'topK', 'frequencyPenalty', 'presencePenalty', 'stopSequences'];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) {
      out[k] = body[k];
    }
  }
  return out;
}

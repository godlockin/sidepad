import Anthropic from '@anthropic-ai/sdk';
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
    const messages = toAnthropicMessages(req.messages as ChatMessage[]);
    const tools =
      req.tools && req.tools.length
        ? req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: (t.inputSchema ?? { type: 'object', properties: {} }) as any,
          }))
        : undefined;
    const thinkingEnabled = supportsExtendedThinking(req.model);
    try {
      const stream: any = await this.client.messages.stream(
        {
          model: req.model,
          messages: messages as any,
          system: req.systemPrompt,
          temperature: req.temperature,
          max_tokens: req.maxTokens ?? 4096,
          ...(tools ? { tools } : {}),
          ...(thinkingEnabled ? { thinking: { type: 'enabled', budget_tokens: 4096 } } : {}),
        } as any,
        { signal },
      );
      // tool_use accumulator keyed by content block index
      const toolBuf = new Map<
        number,
        { id: string; name: string; argText: string }
      >();
      let stopReason: string | null = null;

      for await (const event of stream as AsyncIterable<any>) {
        const t = event.type;
        if (t === 'content_block_start') {
          const cb = event.content_block;
          if (cb?.type === 'tool_use') {
            toolBuf.set(event.index, { id: cb.id, name: cb.name, argText: '' });
          }
        } else if (t === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            yield { delta: event.delta.text };
          } else if (event.delta?.type === 'thinking_delta') {
            if (typeof event.delta.thinking === 'string' && event.delta.thinking.length > 0) {
              yield { reasoningDelta: event.delta.thinking };
            }
          } else if (event.delta?.type === 'input_json_delta') {
            const buf = toolBuf.get(event.index);
            if (buf) buf.argText += event.delta.partial_json ?? '';
          }
        } else if (t === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        }
      }

      // finalMessage gives us authoritative stop_reason + usage
      let final: any = null;
      try {
        final = await stream.finalMessage();
      } catch {
        // ignore — abort path
      }
      const usage = final?.usage
        ? { promptTokens: final.usage.input_tokens, completionTokens: final.usage.output_tokens }
        : undefined;
      const finalStop = final?.stop_reason ?? stopReason;

      let toolCalls: ToolCall[] | undefined;
      if (finalStop === 'tool_use' && toolBuf.size > 0) {
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
          toolCalls.push({ id: b.id, name: b.name, arguments: parsed });
        }
      }

      const finishReason: ChatChunk['finishReason'] =
        finalStop === 'end_turn'
          ? 'stop'
          : finalStop === 'max_tokens'
            ? 'length'
            : finalStop === 'tool_use'
              ? 'tool_calls'
              : 'error';
      yield { finishReason, usage, ...(toolCalls ? { toolCalls } : {}) };
    } catch (err) {
      const n = normalizeError(err);
      if (n.code === 'ABORTED') return;
      throw n;
    }
  }

  capabilities(model: string): ProviderCapabilities {
    // All currently-shipping Claude models support vision input.
    return {
      vision: /(claude-3|claude-opus|claude-sonnet|claude-haiku)/i.test(model),
      reasoning: supportsExtendedThinking(model),
      tools: true,
    };
  }
}

/**
 * Whether a Claude model supports extended thinking. Currently:
 *   - claude-3-7* (Sonnet 3.7)
 *   - claude-opus-4*
 *   - claude-sonnet-4-5*
 */
export function supportsExtendedThinking(model: string): boolean {
  const m = model.toLowerCase();
  if (m.startsWith('claude-3-7')) return true;
  if (m.startsWith('claude-opus-4')) return true;
  if (m.startsWith('claude-sonnet-4-5')) return true;
  return false;
}

/**
 *
 * - system messages are stripped (passed via top-level `system` field).
 * - assistant.toolCalls become content blocks of type 'tool_use'.
 * - role:'tool' messages become a USER message containing tool_result blocks
 *   keyed by tool_use_id (Anthropic represents tool results as user turns).
 *   Consecutive tool results are coalesced into a single user message.
 */
export function toAnthropicMessages(messages: ChatMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
      continue;
    }
    // user
    const userImgs = (m as any).images as Array<{ mime: string; base64: string }> | undefined;
    if (userImgs && userImgs.length) {
      const blocks: any[] = [];
      for (const img of userImgs) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.base64 },
        });
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      out.push({ role: 'user', content: blocks });
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
}

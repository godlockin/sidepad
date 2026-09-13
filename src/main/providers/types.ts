export interface ModelCaps {
  free?: boolean;      // no cost (e.g. OpenRouter :free)
  tools?: boolean;     // function / tool calling
  vision?: boolean;    // image / multimodal input
  reasoning?: boolean; // extended CoT / thinking mode
  web?: boolean;       // built-in web search
  fast?: boolean;      // small / low-latency variant
}

export interface Model {
  id: string;
  name: string;
  contextWindow: number;
  caps?: ModelCaps;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: unknown; // JSON schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Vision input block. Attached to a user message when the active model has
 * `capabilities(model).vision === true`. Providers translate this into their
 * own native format (OpenAI: `image_url`; Anthropic: `image` source/base64;
 * Ollama: top-level `images` field on the message).
 */
export interface ImageInput {
  /** MIME type, e.g. `image/png`, `image/jpeg`, `image/webp`, `image/gif`. */
  mime: string;
  /** Raw base64-encoded image data (no data: prefix). */
  base64: string;
}

export type ChatMessage =
  | { role: 'system'; content: string; name?: string }
  | { role: 'user'; content: string; name?: string; images?: ImageInput[] }
  | { role: 'assistant'; content: string; name?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name?: string };

/**
 * Reasoning/thinking effort tier a caller may request for one model call.
 * 'minimal' asks the model to skip or shrink its thinking phase; 'high'
 * asks for the deepest reasoning budget. Providers translate this into
 * their native parameter (OpenAI `reasoning_effort`, Anthropic
 * `thinking.budget_tokens`, Ollama `think`).
 */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /** Optional effort tier for the model's reasoning/thinking phase. */
  reasoningEffort?: ReasoningEffort;
}

export interface ChatChunk {
  delta?: string;
  reasoningDelta?: string;
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
  toolCalls?: ToolCall[];
}

/**
 * Per-model capability flags. Providers may implement `capabilities(model)`
 * to declare whether a given model id supports vision / extended reasoning /
 * tool calls. Consumers (e.g. the vision router) treat `undefined` as "not
 * supported" — only an explicit `true` enables capability-specific code paths.
 */
export interface ProviderCapabilities {
  vision?: boolean;
  reasoning?: boolean;
  tools?: boolean;
}

export interface LLMProvider {
  id: string;
  readonly configId: string;
  listModels(): Promise<Model[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  capabilities?(model: string): ProviderCapabilities;
}

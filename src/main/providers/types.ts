export interface Model {
  id: string;
  name: string;
  contextWindow: number;
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

export type ChatMessage =
  | { role: 'system'; content: string; name?: string }
  | { role: 'user'; content: string; name?: string }
  | { role: 'assistant'; content: string; name?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name?: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface ChatChunk {
  delta?: string;
  reasoningDelta?: string;
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  id: string;
  readonly configId: string;
  listModels(): Promise<Model[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

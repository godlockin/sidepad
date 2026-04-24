export interface Model {
  id: string;
  name: string;
  contextWindow: number;
}

export interface ChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
  }>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatChunk {
  delta?: string;
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: 'stop' | 'length' | 'error';
}

export interface LLMProvider {
  id: string;
  readonly configId: string;
  listModels(): Promise<Model[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

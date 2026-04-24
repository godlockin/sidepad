// src/main/store/types.ts

export interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  systemPrompt: string | null;
  visibilityMode: 'independent' | 'full';
  groupMode: 'parallel' | 'relay';
  defaultAgentId: string | null;
  participants: string[];
  folderId: string | null;
  projectId: string | null;
  pinned: boolean;
  archived: boolean;
  parentMessageId: string | null;
}

export interface Message {
  id: string;
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  modelId: string | null;
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  status: 'streaming' | 'done' | 'error' | 'aborted' | 'partial';
  error: string | null;
  parentMessageId: string | null;
  metaJson: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface MessageMeta {
  agentId: string;
  providerId: string;
  modelId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  [key: string]: unknown;
}

export interface ChatRequest {
  providerId: string;
  modelId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

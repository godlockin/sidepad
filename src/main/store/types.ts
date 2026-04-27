// src/main/store/types.ts

export interface Participant {
  agentId: string;
  personaId: string;
}

export interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  systemPrompt: string | null;
  visibilityMode: 'independent' | 'full';
  groupMode: 'parallel' | 'relay';
  defaultAgentId: string | null;
  participants: Participant[];
  folderId: string | null;
  projectId: string | null;
  pinned: boolean;
  archived: boolean;
  parentMessageId: string | null;
  iconKind: 'emoji' | 'image' | null;
  iconValue: string | null;
}

export type IconKind = 'emoji' | 'image';

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
  reasoning: string | null;
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

export type MountRole = 'refs' | 'inputs' | 'workspace' | 'outputs' | 'scratch';

export interface Project {
  id: string;
  name: string;
  rootDir: string | null;
  cwdResolution: 'workspace' | 'inputs' | 'manual' | null;
  createdAt: number;
  updatedAt: number;
}

export interface MountPoint {
  id: string;
  projectId: string;
  role: MountRole;
  path: string;
  label: string | null;
  readOnly: boolean;
  createdAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  sessionId: string | null;
  title: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  outputDir: string | null;
  scratchDir: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

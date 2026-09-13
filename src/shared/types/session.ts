// Shared session/message types — single source of truth for main + renderer

export interface Participant {
  agentId: string;
  personaId: string;
}

/**
 * Collaboration mode for a session.
 * - 'auto': mode is inferred from @-mentions and trigger phrases
 * - 'relay' | 'parallel' | 'roundtable' | 'lead-and-comment': explicit override
 * Persisted in sessions.collab_mode (migration 025). The legacy group_mode
 * column has a CHECK constraint limited to ('parallel','relay') and is no
 * longer written.
 */
export type GroupMode = 'auto' | 'parallel' | 'relay' | 'roundtable' | 'lead-and-comment';

export const GROUP_MODES: readonly GroupMode[] = ['auto', 'parallel', 'relay', 'roundtable', 'lead-and-comment'];

export function parseGroupMode(raw: unknown): GroupMode {
  return typeof raw === 'string' && (GROUP_MODES as readonly string[]).includes(raw)
    ? (raw as GroupMode)
    : 'auto';
}

export interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  systemPrompt: string | null;
  visibilityMode: 'independent' | 'full';
  groupMode: GroupMode;
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

/** Store-layer chat request (providerId + modelId), distinct from provider-layer ChatRequest. */
export interface StoreChatRequest {
  providerId: string;
  modelId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

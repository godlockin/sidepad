// Re-export from shared layer — single source of truth
export type { Participant, Session, IconKind, Message, MessageMeta } from '../../shared/types/session';

// StoreChatRequest re-exported as ChatRequest for backward compat with session-store
export type { StoreChatRequest as ChatRequest } from '../../shared/types/session';

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

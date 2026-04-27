// Shared orchestrator event types — single source of truth for main + renderer

export type OrchestratorEvent =
  | { type: 'turn:start'; turnId: string; mode: string }
  | { type: 'message:start'; turnId: string; msgId: string; agentId: string; mode: string }
  | { type: 'message:delta'; turnId: string; msgId: string; agentId: string; delta: string }
  | { type: 'message:reasoning_delta'; turnId: string; msgId: string; agentId: string; delta: string }
  | { type: 'message:finish'; turnId: string; msgId: string; agentId: string; finishReason: string; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'message:error'; turnId: string; msgId: string; agentId: string; code: string; message: string; retriable: boolean }
  | {
      type: 'tool_call:start';
      turnId: string;
      msgId: string;
      agentId: string;
      toolCallId: string;
      serverId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_call:result';
      turnId: string;
      msgId: string;
      agentId: string;
      toolCallId: string;
      result?: unknown;
      isError: boolean;
      durationMs: number;
    }
  | { type: 'turn:complete'; turnId: string };

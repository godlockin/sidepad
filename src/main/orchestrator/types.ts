export type OrchestratorEvent =
  | { type: 'turn:start'; turnId: string; mode: string }
  | { type: 'message:start'; turnId: string; msgId: string; agentId: string; mode: string }
  | { type: 'message:delta'; turnId: string; msgId: string; agentId: string; delta: string }
  | { type: 'message:finish'; turnId: string; msgId: string; agentId: string; finishReason: string; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'message:error'; turnId: string; msgId: string; agentId: string; code: string; message: string; retriable: boolean }
  | { type: 'turn:complete'; turnId: string };

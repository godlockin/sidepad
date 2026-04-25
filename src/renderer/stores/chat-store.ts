import { create } from 'zustand';
import type { Unsubscribable } from '@trpc/server/observable';
import { trpc } from '../lib/trpc-client';
import type { Message } from '../../main/store/types';
import type { OrchestratorEvent } from '../../main/orchestrator/types';

export interface ToolCallView {
  id: string;
  name: string;
  serverId: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  status: 'pending' | 'done' | 'error';
}

interface ChatState {
  messages: Message[];
  streaming: boolean;
  currentTurnId: string | null;
  subRef: Unsubscribable | null;
  turnEvents: OrchestratorEvent[];
  streamingContent: Map<string, string>; // msgId -> accumulated content
  toolCalls: Map<string, ToolCallView[]>; // msgId -> tool calls

  setMessages: (msgs: Message[]) => void;
  sendMessage: (sessionId: string, text: string, mentions: string[]) => Promise<void>;
  stopStreaming: () => void;
  set: (partial: Partial<ChatState>) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  currentTurnId: null,
  subRef: null,
  turnEvents: [],
  streamingContent: new Map(),
  toolCalls: new Map(),

  setMessages: (msgs: Message[]) => set({ messages: msgs, streamingContent: new Map(), toolCalls: new Map() }),

  sendMessage: async (sessionId: string, text: string, mentions: string[]) => {
    const { subRef } = get();
    if (subRef) {
      subRef.unsubscribe();
    }

    // Optimistic: add user message to local state
    const userMsg: Message = {
      id: `optimistic-user-${Date.now()}`,
      sessionId,
      turnId: '',
      role: 'user',
      modelId: null,
      content: text,
      promptTokens: null,
      completionTokens: null,
      status: 'done',
      error: null,
      parentMessageId: null,
      metaJson: null,
      reasoning: null,
      createdAt: Date.now(),
      finishedAt: null,
    };

    set({
      messages: [...get().messages, userMsg],
      streaming: true,
      turnEvents: [],
      streamingContent: new Map(),
      toolCalls: new Map(),
    });

    const sub = trpc.chat.send.subscribe(
      { sessionId, text, mentions },
      {
        onData: (ev: OrchestratorEvent) => {
          set((state) => ({ turnEvents: [...state.turnEvents, ev] }));

          if (ev.type === 'turn:start') {
            set({ currentTurnId: ev.turnId });
          }

          if (ev.type === 'message:reasoning_delta') {
            const { messages } = get();
            const existing = messages.find((m) => m.id === ev.msgId);
            if (existing) {
              const prev = (existing as Message & { reasoning?: string }).reasoning ?? '';
              set({
                messages: messages.map((m) =>
                  m.id === ev.msgId
                    ? ({ ...m, reasoning: prev + ev.delta } as Message)
                    : m,
                ),
              });
            } else {
              const assistantMsg: Message = {
                id: ev.msgId,
                sessionId,
                turnId: ev.turnId,
                role: 'assistant',
                modelId: null,
                content: '',
                promptTokens: null,
                completionTokens: null,
                status: 'streaming',
                error: null,
                parentMessageId: null,
                metaJson: JSON.stringify({ agentId: ev.agentId }),
                reasoning: ev.delta,
                createdAt: Date.now(),
                finishedAt: null,
              };
              set({ messages: [...messages, assistantMsg] });
            }
          }

          if (ev.type === 'message:delta') {
            const { streamingContent } = get();
            const current = streamingContent.get(ev.msgId) || '';
            streamingContent.set(ev.msgId, current + ev.delta);

            // Create or update assistant message in local state
            const { messages } = get();
            if (!messages.find((m) => m.id === ev.msgId)) {
              const assistantMsg: Message = {
                id: ev.msgId,
                sessionId,
                turnId: ev.turnId,
                role: 'assistant',
                modelId: null,
                content: current + ev.delta,
                promptTokens: null,
                completionTokens: null,
                status: 'streaming',
                error: null,
                parentMessageId: null,
                metaJson: JSON.stringify({ agentId: ev.agentId }),
                reasoning: null,
                createdAt: Date.now(),
                finishedAt: null,
              };
              set({ messages: [...messages, assistantMsg] });
            } else {
              set({
                messages: messages.map((m) =>
                  m.id === ev.msgId ? { ...m, content: streamingContent.get(ev.msgId) || '', status: 'streaming' as const } : m,
                ),
              });
            }
          }

          if (ev.type === 'message:finish') {
            const { messages, streamingContent } = get();
            set({
              messages: messages.map((m) =>
                m.id === ev.msgId
                  ? { ...m, content: streamingContent.get(ev.msgId) || '', status: 'done' as const }
                  : m,
              ),
            });
          }

          if (ev.type === 'message:error') {
            const { messages } = get();
            const errMsg: Message = {
              id: ev.msgId || `error-${Date.now()}`,
              sessionId,
              turnId: ev.turnId,
              role: 'assistant',
              modelId: null,
              content: '',
              promptTokens: null,
              completionTokens: null,
              status: 'error',
              error: ev.message,
              parentMessageId: null,
              metaJson: JSON.stringify({ agentId: ev.agentId }),
              reasoning: null,
              createdAt: Date.now(),
              finishedAt: null,
            };
            set({ messages: [...messages, errMsg] });
          }

          if (ev.type === 'tool_call:start') {
            const { toolCalls } = get();
            const list = toolCalls.get(ev.msgId) ?? [];
            list.push({
              id: ev.toolCallId,
              name: ev.toolName,
              serverId: ev.serverId,
              args: ev.args,
              status: 'pending',
            });
            toolCalls.set(ev.msgId, list);
            set({ toolCalls: new Map(toolCalls) });
          }

          if (ev.type === 'tool_call:result') {
            const { toolCalls } = get();
            const list = toolCalls.get(ev.msgId) ?? [];
            const idx = list.findIndex((c) => c.id === ev.toolCallId);
            if (idx >= 0) {
              list[idx] = {
                ...list[idx],
                result: ev.result,
                isError: ev.isError,
                durationMs: ev.durationMs,
                status: ev.isError ? 'error' : 'done',
              };
              toolCalls.set(ev.msgId, [...list]);
              set({ toolCalls: new Map(toolCalls) });
            }
          }

          if (ev.type === 'turn:complete') {
            set({ streaming: false, currentTurnId: null, subRef: null });
          }
        },
        onError: (err) => {
          console.error('Chat stream error:', err);
          set({ streaming: false, currentTurnId: null, subRef: null });
        },
        onComplete: () => {
          set({ streaming: false, currentTurnId: null, subRef: null });
        },
      },
    );

    set({ subRef: sub });
  },

  stopStreaming: () => {
    const { subRef } = get();
    if (subRef) {
      subRef.unsubscribe();
    }
    set({ streaming: false, currentTurnId: null, subRef: null });
  },

  set: (partial) => set(partial),
}));

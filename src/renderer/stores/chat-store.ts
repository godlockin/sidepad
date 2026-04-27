import { create } from 'zustand';
import type { Unsubscribable } from '@trpc/server/observable';
import { getQueryClient } from '../lib/query-client';
import { messagesKey } from '../hooks/useMessages';
import { trpc } from '../lib/trpc-client';
import type { Message, OrchestratorEvent } from '../../shared/types';

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
  // UI-only state
  streaming: boolean;
  currentTurnId: string | null;
  subRef: Unsubscribable | null;
  turnEvents: OrchestratorEvent[];
  streamingContent: Map<string, string>; // msgId -> accumulated content
  toolCalls: Map<string, ToolCallView[]>; // msgId -> tool calls

  sendMessage: (sessionId: string, text: string, mentions: string[], attachmentIds?: string[]) => Promise<void>;
  stopStreaming: () => void;
  set: (partial: Partial<ChatState>) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  streaming: false,
  currentTurnId: null,
  subRef: null,
  turnEvents: [],
  streamingContent: new Map(),
  toolCalls: new Map(),

  sendMessage: async (sessionId: string, text: string, mentions: string[], attachmentIds?: string[]) => {
    const { subRef } = get();
    if (subRef) {
      subRef.unsubscribe();
    }

    const optimisticId = `optimistic-user-${Date.now()}`;

    // Resolve attachment markdown bodies and compose final user content.
    let finalText = text;
    const ids = attachmentIds ?? [];
    if (ids.length > 0) {
      try {
        const rows = await Promise.all(
          ids.map((id) => trpc.attachment.get.query({ id })),
        );
        const valid = rows.filter((r): r is NonNullable<typeof r> => r != null);
        const totalTokens = valid.reduce(
          (sum, r) => sum + (r.token_estimate ?? 0),
          0,
        );
        const inline = totalTokens <= 8000;
        const blocks = valid.map((r) => {
          const ext = (r.filename ?? '').split('.').pop()?.toLowerCase() ?? '';
          const tokens = r.token_estimate ?? 0;
          if (inline) {
            return `<attachment filename="${r.filename}" type="${ext}" tokens="${tokens}">\n${r.parsed_markdown ?? ''}\n</attachment>`;
          }
          return `<attachment id="${r.id}" filename="${r.filename}" type="${ext}" tokens="${tokens}">[Large file — use parse_document tool to read]</attachment>`;
        });
        finalText = [text, ...blocks].join('\n\n');
      } catch (err) {
        console.error('failed to resolve attachments', err);
        set({ streaming: false });
        return;
      }
    }

    // Optimistic: inject user message into query cache
    const qc = getQueryClient();
    const key = messagesKey(sessionId);
    const prevMsgs = qc.getQueryData<Message[]>(key) ?? [];
    const userMsg: Message = {
      id: optimisticId,
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
    qc.setQueryData<Message[]>(key, [...prevMsgs, userMsg]);

    set({
      streaming: true,
      turnEvents: [],
      streamingContent: new Map(),
      toolCalls: new Map(),
    });

    const sub = trpc.chat.send.subscribe(
      { sessionId, text: finalText, mentions, attachmentIds: ids },
      {
        onData: (ev: OrchestratorEvent) => {
          set((state) => ({ turnEvents: [...state.turnEvents, ev] }));

          if (ev.type === 'turn:start') {
            set({ currentTurnId: ev.turnId });
          }

          if (ev.type === 'message:reasoning_delta') {
            const msgs = qc.getQueryData<Message[]>(key) ?? [];
            const existing = msgs.find((m) => m.id === ev.msgId);
            if (existing) {
              const prevReasoning = (existing as Message & { reasoning?: string }).reasoning ?? '';
              qc.setQueryData<Message[]>(
                key,
                msgs.map((m) =>
                  m.id === ev.msgId
                    ? ({ ...m, reasoning: prevReasoning + ev.delta } as Message)
                    : m,
                ),
              );
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
              qc.setQueryData<Message[]>(key, [...(qc.getQueryData<Message[]>(key) ?? []), assistantMsg]);
            }
          }

          if (ev.type === 'message:delta') {
            const { streamingContent } = get();
            const current = streamingContent.get(ev.msgId) || '';
            streamingContent.set(ev.msgId, current + ev.delta);

            const msgs = qc.getQueryData<Message[]>(key) ?? [];
            if (!msgs.find((m) => m.id === ev.msgId)) {
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
              qc.setQueryData<Message[]>(key, [...msgs, assistantMsg]);
            } else {
              qc.setQueryData<Message[]>(
                key,
                msgs.map((m) =>
                  m.id === ev.msgId
                    ? { ...m, content: streamingContent.get(ev.msgId) || '', status: 'streaming' as const }
                    : m,
                ),
              );
            }
          }

          if (ev.type === 'message:finish') {
            const { streamingContent } = get();
            const msgs = qc.getQueryData<Message[]>(key) ?? [];
            qc.setQueryData<Message[]>(
              key,
              msgs.map((m) =>
                m.id === ev.msgId
                  ? { ...m, content: streamingContent.get(ev.msgId) || '', status: 'done' as const }
                  : m,
              ),
            );
          }

          if (ev.type === 'message:error') {
            const msgs = qc.getQueryData<Message[]>(key) ?? [];
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
            qc.setQueryData<Message[]>(key, [...msgs, errMsg]);
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
            // Sync cache with DB after turn finishes
            void qc.invalidateQueries({ queryKey: key });
          }
        },
        onError: (err) => {
          console.error('Chat stream error:', err);
          set({ streaming: false, currentTurnId: null, subRef: null });
          void qc.invalidateQueries({ queryKey: key });
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

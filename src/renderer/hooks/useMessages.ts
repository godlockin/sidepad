import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../lib/trpc-client';
import type { Message } from '../../shared/types';

export const messagesKey = (sessionId: string | null) => ['messages', sessionId] as const;

export function useMessages(sessionId: string | null) {
  return useQuery({
    queryKey: messagesKey(sessionId),
    queryFn: (): Promise<Message[]> =>
      sessionId
        ? trpc.session.messages.query({ sessionId })
        : Promise.resolve([]),
    enabled: !!sessionId,
    staleTime: 0,
    placeholderData: (prev: Message[] | undefined) => prev,
  });
}

export function useSetMessages() {
  const queryClient = useQueryClient();
  return (sessionId: string | null, msgs: Message[]) => {
    queryClient.setQueryData(messagesKey(sessionId), msgs);
  };
}

export function useInvalidateMessages() {
  const queryClient = useQueryClient();
  return (sessionId: string | null) => {
    if (sessionId) {
      void queryClient.invalidateQueries({ queryKey: messagesKey(sessionId) });
    }
  };
}

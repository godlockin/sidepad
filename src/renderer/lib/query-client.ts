import { QueryClient } from '@tanstack/react-query';

// Singleton QueryClient — shared between React tree (via Provider) and Zustand store
let _client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (!_client) {
    _client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    });
  }
  return _client;
}

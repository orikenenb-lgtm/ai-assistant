import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api';

const MAX_RETRIES = 2;

/** Retry only transient failures: network errors and 5xx. Never retry 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error)) {
    if (error.status >= 400 && error.status < 500) return false;
    if (error.code === 'INVALID_RESPONSE') return false;
  }
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

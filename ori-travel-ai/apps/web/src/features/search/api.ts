/** Search API (contract §3.3, owner B2). */
import { api } from '@/lib/api';
import type { Category } from '@/lib/schemas/common';
import { SearchHistoryPageSchema, SearchResponseSchema } from '@/lib/schemas/search';

export const searchKeys = {
  all: ['search'] as const,
  history: (params: { page: number; pageSize: number }) => ['search', 'history', params] as const,
  result: (searchId: string, weights?: string) => ['search', 'result', searchId, weights ?? null] as const,
};

export function fetchSearchHistory(params: { page: number; pageSize: number }) {
  return api.get('/api/search/history', {
    schema: SearchHistoryPageSchema,
    query: { page: params.page, page_size: params.pageSize },
  });
}

/** POST /api/search/{category} — body is the validated params object (server re-validates). */
export function runSearch(category: Category, body: Record<string, unknown>) {
  return api.post(`/api/search/${category}`, body, { schema: SearchResponseSchema });
}

/** GET /api/search/{id}[?weights=cost:40,…] — stored search, optionally re-ranked. */
export function fetchSearchResult(searchId: string, weights?: string, signal?: AbortSignal) {
  return api.get(`/api/search/${encodeURIComponent(searchId)}`, {
    schema: SearchResponseSchema,
    query: { weights },
    signal,
  });
}

/** Search API (contract §3.3, owner B2). Search forms/results are added by later agents. */
import { api } from '@/lib/api';
import { SearchHistoryPageSchema } from '@/lib/schemas/search';

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

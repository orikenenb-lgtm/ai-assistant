import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category } from '@/lib/schemas/common';
import { fetchSearchHistory, fetchSearchResult, runSearch, searchKeys } from './api';

export function useSearchHistory(page = 1, pageSize = 5) {
  return useQuery({
    queryKey: searchKeys.history({ page, pageSize }),
    queryFn: () => fetchSearchHistory({ page, pageSize }),
  });
}

/** Stored search by id; `weights` (e.g. "cost:40,convenience:25,…") re-ranks it server-side. */
export function useSearchResult(searchId: string | null, weights?: string) {
  return useQuery({
    queryKey: searchKeys.result(searchId ?? '', weights),
    queryFn: ({ signal }) => fetchSearchResult(searchId as string, weights, signal),
    enabled: !!searchId,
    // Keep the previous ranking visible while a custom-weights re-rank loads (never across different searches).
    placeholderData: weights ? keepPreviousData : undefined,
    staleTime: 60_000,
  });
}

export function useRunSearch(category: Category) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => runSearch(category, body),
    onSuccess: (data) => {
      qc.setQueryData(searchKeys.result(data.search_id), data);
      void qc.invalidateQueries({ queryKey: ['search', 'history'] });
    },
  });
}

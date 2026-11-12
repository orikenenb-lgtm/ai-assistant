import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { compareKeys, fetchFxRates, postComparison } from './api';

/** POST is used as a read here: the comparison is computed server-side from the persisted offers. */
export function useComparison(offerIds: string[], weights?: Record<string, number>) {
  const weightsKey = weights ? JSON.stringify(weights) : undefined;
  return useQuery({
    queryKey: compareKeys.result(offerIds, weightsKey),
    queryFn: ({ signal }) => postComparison(offerIds, weights, signal),
    enabled: offerIds.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

export function useFxRates(enabled: boolean) {
  return useQuery({ queryKey: compareKeys.fx, queryFn: fetchFxRates, enabled, staleTime: 10 * 60_000 });
}

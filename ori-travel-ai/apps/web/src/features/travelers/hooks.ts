import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { familyKeys } from '@/features/family/api';
import { isApiError } from '@/lib/api';
import { deleteTraveler, fetchTraveler, saveTraveler, travelerKeys } from './api';

/** `enabled` should be `member.has_traveler_profile` — a member without a profile returns 404. */
export function useTraveler(memberId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: travelerKeys.detail(memberId ?? ''),
    queryFn: () => fetchTraveler(memberId as string),
    enabled: !!memberId && enabled,
    retry: (count, error) => !(isApiError(error) && error.isClientError) && count < 1,
  });
}

export function useSaveTraveler(memberId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => saveTraveler(memberId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: travelerKeys.all });
      void qc.invalidateQueries({ queryKey: familyKeys.members });
    },
  });
}

export function useDeleteTraveler(memberId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteTraveler(memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: travelerKeys.all });
      void qc.invalidateQueries({ queryKey: familyKeys.members });
    },
  });
}

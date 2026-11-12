import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteSaved, fetchSaved, savedKeys, updateSaved } from './api';

export function useSavedOffers() {
  return useQuery({ queryKey: savedKeys.all, queryFn: fetchSaved });
}

export function useUpdateSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { note?: string | null; trip_id?: string | null } }) => updateSaved(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedKeys.all }),
  });
}

export function useDeleteSaved() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSaved(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedKeys.all }),
  });
}

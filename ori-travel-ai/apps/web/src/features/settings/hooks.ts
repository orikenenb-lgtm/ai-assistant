import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, putSetting, runRetention, settingsKeys } from './api';

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.all, queryFn: fetchSettings, staleTime: 30_000 });
}

export function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: Parameters<typeof putSetting>[0]; body: Record<string, unknown> }) => putSetting(path, body),
    onSuccess: (data) => qc.setQueryData(settingsKeys.all, data),
  });
}

export function useRunRetention() {
  return useMutation({ mutationFn: runRetention });
}

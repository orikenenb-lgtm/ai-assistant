import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNotifications, notificationKeys } from '@/features/notifications/api';
import { alertKeys, checkAlert, createAlert, deleteAlert, fetchAlerts, fetchSnapshots, updateAlert } from './api';

export function useAlerts() {
  return useQuery({ queryKey: alertKeys.list, queryFn: fetchAlerts });
}

export function useSnapshots(id: string, enabled: boolean) {
  return useQuery({ queryKey: alertKeys.snapshots(id), queryFn: () => fetchSnapshots(id), enabled });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createAlert(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.all }),
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateAlert(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.all }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.all }),
  });
}

export function useCheckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkAlert(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: alertKeys.all });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** In-page notifications list (first 20, newest first). */
export function useNotificationsList() {
  const params = { page: 1, pageSize: 20 };
  return useQuery({ queryKey: notificationKeys.list(params), queryFn: () => fetchNotifications(params), retry: false });
}

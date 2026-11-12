import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
} from './api';

export const UNREAD_POLL_MS = 60_000;

/** Polls the unread count every 60s (stops polling if the endpoint does not exist yet). */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: fetchUnreadCount,
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const err = query.state.error;
      return isApiError(err) && (err.status === 404 || err.status === 403) ? false : UNREAD_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useRecentNotifications(enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.list({ page: 1, pageSize: 8 }),
    queryFn: () => fetchNotifications({ page: 1, pageSize: 8 }),
    enabled,
    retry: false,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

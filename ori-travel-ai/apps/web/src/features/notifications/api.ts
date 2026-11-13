/** Notifications API (contract §3.2, owner B1). */
import { api } from '@/lib/api';
import { NotificationPageSchema, UnreadCountSchema } from '@/lib/schemas/notifications';

export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  list: (params: { page: number; pageSize: number; unreadOnly?: boolean }) => ['notifications', 'list', params] as const,
};

export function fetchUnreadCount() {
  return api.get('/api/notifications/unread-count', { schema: UnreadCountSchema });
}

export function fetchNotifications(params: { page: number; pageSize: number; unreadOnly?: boolean }) {
  return api.get('/api/notifications', {
    schema: NotificationPageSchema,
    query: { page: params.page, page_size: params.pageSize, unread_only: params.unreadOnly || undefined },
  });
}

export function markNotificationRead(id: string) {
  return api.post(`/api/notifications/${encodeURIComponent(id)}/read`);
}

export function markAllNotificationsRead() {
  return api.post('/api/notifications/read-all');
}

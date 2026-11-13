/** Price alerts API — contract §3.4 (price_tracking). */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { AlertListSchema, AlertSchema, CheckResultSchema, SnapshotListSchema } from '@/lib/schemas/alerts';

export const alertKeys = {
  all: ['alerts'] as const,
  list: ['alerts', 'list'] as const,
  snapshots: (id: string) => ['alerts', 'snapshots', id] as const,
};

const base = (id: string) => `/api/alerts/${encodeURIComponent(id)}`;

export const fetchAlerts = () => api.get('/api/alerts', { schema: AlertListSchema });
export const createAlert = (body: Record<string, unknown>) => api.post('/api/alerts', body, { schema: AlertSchema });
export const updateAlert = (id: string, body: Record<string, unknown>) => api.patch(base(id), body, { schema: AlertSchema });
export const deleteAlert = (id: string) => api.delete(base(id), { schema: OkResponseSchema });
export const checkAlert = (id: string) => api.post(`${base(id)}/check`, undefined, { schema: CheckResultSchema });
export const fetchSnapshots = (id: string) => api.get(`${base(id)}/snapshots`, { schema: SnapshotListSchema });

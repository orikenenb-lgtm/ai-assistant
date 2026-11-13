/** Family settings API — contract §3.2. Every PUT returns the full settings object. */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { RetentionRunSchema, SettingsSchema } from '@/lib/schemas/settings';

export const settingsKeys = { all: ['settings'] as const };

export const fetchSettings = () => api.get('/api/settings', { schema: SettingsSchema });
export const putSetting = (path: 'ranking-weights' | 'scheduler' | 'map' | 'display' | 'retention', body: Record<string, unknown>) =>
  api.put(`/api/settings/${path}`, body, { schema: SettingsSchema });
export const runRetention = () => api.post('/api/settings/retention/run', undefined, { schema: RetentionRunSchema });
export const changePassword = (body: { current_password: string; new_password: string }) =>
  api.post('/api/auth/change-password', body, { schema: OkResponseSchema });

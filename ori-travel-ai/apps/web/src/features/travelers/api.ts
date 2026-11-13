/** Traveler profiles — contract §3.2. Identity fields are encrypted at rest on the server. */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { PassportRevealSchema, TravelerDetailSchema } from '@/lib/schemas/family';

export const travelerKeys = {
  all: ['travelers'] as const,
  detail: (memberId: string) => ['travelers', 'detail', memberId] as const,
};

const base = (id: string) => `/api/travelers/${encodeURIComponent(id)}`;

export const fetchTraveler = (memberId: string) => api.get(base(memberId), { schema: TravelerDetailSchema });
export const saveTraveler = (memberId: string, body: Record<string, unknown>) =>
  api.put(base(memberId), body, { schema: TravelerDetailSchema });
export const deleteTraveler = (memberId: string) => api.delete(base(memberId), { schema: OkResponseSchema });
export const revealPassport = (memberId: string) => api.post(`${base(memberId)}/passport/reveal`, undefined, { schema: PassportRevealSchema });
export const reauth = (password: string) => api.post('/api/auth/reauth', { password }, { schema: OkResponseSchema });

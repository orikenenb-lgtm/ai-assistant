/** Saved offers (per-user shortlist) — contract §3.4. */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { SavedOfferListSchema, SavedOfferSchema } from '@/lib/schemas/saved';

/** Same root key as features/offers (`offerKeys.saved`) so saving from search refreshes this list. */
export const savedKeys = { all: ['saved-offers'] as const };

export const fetchSaved = () => api.get('/api/saved-offers', { schema: SavedOfferListSchema });

export const updateSaved = (id: string, body: { note?: string | null; trip_id?: string | null }) =>
  api.patch(`/api/saved-offers/${encodeURIComponent(id)}`, body, { schema: SavedOfferSchema });

export const deleteSaved = (id: string) => api.delete(`/api/saved-offers/${encodeURIComponent(id)}`, { schema: OkResponseSchema });

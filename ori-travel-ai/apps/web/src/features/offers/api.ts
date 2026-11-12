/** Offer-related API calls (contract §3.3 /api/offers, §3.4 saved offers + trip items). */
import { z } from 'zod';
import { api } from '@/lib/api';
import { CanonicalOfferSchema } from '@/lib/schemas/offers';

export const offerKeys = {
  all: ['offers'] as const,
  detail: (id: string) => ['offers', 'detail', id] as const,
  saved: ['saved-offers'] as const,
};

export function fetchOffer(offerId: string) {
  return api.get(`/api/offers/${encodeURIComponent(offerId)}`, { schema: CanonicalOfferSchema });
}

/** Response shapes of the saved-offers / trip-items endpoints are owned by other modules; we only need success. */
const AnyResponse = z.unknown();

export function saveOffer(input: { offerId: string; note?: string; tripId?: string }) {
  return api.post(
    '/api/saved-offers',
    { offer_id: input.offerId, ...(input.note ? { note: input.note } : {}), ...(input.tripId ? { trip_id: input.tripId } : {}) },
    { schema: AnyResponse },
  );
}

/**
 * POST /api/trips/{id}/items/from-offer. A 409 `ITEM_OVERLAP` means the new item(s) would overlap forbidden items
 * (flight×flight, activity×flight, …); resending with `allowOverlap` saves it anyway (still flagged by the server).
 */
export function addOfferToTrip(input: { tripId: string; offerId: string; allowOverlap?: boolean }) {
  const body = input.allowOverlap ? { offer_id: input.offerId, allow_overlap: true } : { offer_id: input.offerId };
  return api.post(`/api/trips/${encodeURIComponent(input.tripId)}/items/from-offer`, body, { schema: AnyResponse });
}

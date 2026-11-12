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

export function addOfferToTrip(input: { tripId: string; offerId: string }) {
  return api.post(`/api/trips/${encodeURIComponent(input.tripId)}/items/from-offer`, { offer_id: input.offerId }, { schema: AnyResponse });
}

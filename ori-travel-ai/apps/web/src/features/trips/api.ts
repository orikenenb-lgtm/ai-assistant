/** Trips API (contract §3.4, itineraries module). */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import {
  BudgetSchema,
  FromOfferResultSchema,
  TripDetailSchema,
  TripItemSchema,
  TripSummaryListSchema,
} from '@/lib/schemas/trips';

export const tripKeys = {
  all: ['trips'] as const,
  list: ['trips', 'list'] as const,
  detail: (id: string) => ['trips', 'detail', id] as const,
  budget: (id: string) => ['trips', 'budget', id] as const,
};

const base = (id: string) => `/api/trips/${encodeURIComponent(id)}`;

export function fetchTrips() {
  return api.get('/api/trips', { schema: TripSummaryListSchema });
}

export function fetchTrip(id: string) {
  return api.get(base(id), { schema: TripDetailSchema });
}

export function fetchBudget(id: string) {
  return api.get(`${base(id)}/budget`, { schema: BudgetSchema });
}

export type TripBody = Record<string, unknown>;

export function createTrip(body: TripBody) {
  return api.post('/api/trips', body, { schema: TripDetailSchema });
}

export function updateTrip(id: string, body: TripBody) {
  return api.patch(base(id), body, { schema: TripDetailSchema });
}

export function deleteTrip(id: string) {
  return api.delete(base(id), { schema: OkResponseSchema });
}

export function createItem(tripId: string, body: TripBody) {
  return api.post(`${base(tripId)}/items`, body, { schema: TripItemSchema });
}

export function updateItem(tripId: string, itemId: string, body: TripBody) {
  return api.patch(`${base(tripId)}/items/${encodeURIComponent(itemId)}`, body, { schema: TripItemSchema });
}

export function deleteItem(tripId: string, itemId: string) {
  return api.delete(`${base(tripId)}/items/${encodeURIComponent(itemId)}`, { schema: OkResponseSchema });
}

export function reorderItems(tripId: string, itemIds: string[]) {
  return api.post(`${base(tripId)}/items/reorder`, { item_ids: itemIds }, { schema: TripDetailSchema });
}

export function addItemFromOffer(tripId: string, offerId: string) {
  return api.post(`${base(tripId)}/items/from-offer`, { offer_id: offerId }, { schema: FromOfferResultSchema });
}

export const exportUrl = (tripId: string, kind: 'ics' | 'pdf') => `${base(tripId)}/export.${kind}`;

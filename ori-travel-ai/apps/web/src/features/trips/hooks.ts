import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripSummary } from '@/lib/schemas/trips';
import {
  addItemFromOffer,
  createItem,
  createTrip,
  deleteItem,
  deleteTrip,
  fetchBudget,
  fetchTrip,
  fetchTrips,
  reorderItems,
  tripKeys,
  updateItem,
  updateTrip,
  type TripBody,
} from './api';

export function useTrips() {
  return useQuery({ queryKey: tripKeys.list, queryFn: fetchTrips });
}

export function useTrip(id: string) {
  return useQuery({ queryKey: tripKeys.detail(id), queryFn: () => fetchTrip(id), enabled: !!id });
}

export function useTripBudget(id: string) {
  return useQuery({ queryKey: tripKeys.budget(id), queryFn: () => fetchBudget(id), enabled: !!id });
}

/** Trips that have not ended yet (or have no dates), soonest first. */
export function upcomingTrips(trips: TripSummary[], today = new Date()): TripSummary[] {
  const todayIso = today.toISOString().slice(0, 10);
  return trips
    .filter((t) => !t.end_date || t.end_date >= todayIso)
    .sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
}

/** Any trip/item/budget change invalidates every trip query (lists, detail, budget). */
function useInvalidateTrips() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: tripKeys.all });
}

export function useCreateTrip() {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (body: TripBody) => createTrip(body), onSuccess: invalidate });
}

export function useUpdateTrip(id: string) {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (body: TripBody) => updateTrip(id, body), onSuccess: invalidate });
}

export function useDeleteTrip() {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (id: string) => deleteTrip(id), onSuccess: invalidate });
}

export function useCreateItem(tripId: string) {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (body: TripBody) => createItem(tripId, body), onSuccess: invalidate });
}

export function useUpdateItem(tripId: string) {
  const invalidate = useInvalidateTrips();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: TripBody }) => updateItem(tripId, itemId, body),
    onSuccess: invalidate,
  });
}

export function useDeleteItem(tripId: string) {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (itemId: string) => deleteItem(tripId, itemId), onSuccess: invalidate });
}

export function useReorderItems(tripId: string) {
  const invalidate = useInvalidateTrips();
  return useMutation({ mutationFn: (ids: string[]) => reorderItems(tripId, ids), onSuccess: invalidate });
}

export function useAddItemFromOffer() {
  const invalidate = useInvalidateTrips();
  return useMutation({
    mutationFn: ({ tripId, offerId }: { tripId: string; offerId: string }) => addItemFromOffer(tripId, offerId),
    onSuccess: invalidate,
  });
}

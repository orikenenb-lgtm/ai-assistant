import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api';
import type { Booking, BookingCreateBody } from '@/lib/schemas/bookings';
import {
  approveBooking,
  bookingKeys,
  cancelBooking,
  createBooking,
  fetchBooking,
  fetchBookings,
  reconcileBooking,
  recordConfirmation,
  revalidateBooking,
  submitBooking,
  updateTravelers,
} from './api';
import { REFETCH_CODES } from './errors';

export function useBookings(state: string | null, page: number) {
  return useQuery({
    queryKey: bookingKeys.list(state, page),
    queryFn: () => fetchBookings(state, page),
    placeholderData: keepPreviousData,
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: bookingKeys.detail(id ?? ''),
    queryFn: () => fetchBooking(id as string),
    enabled: !!id,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookingCreateBody) => createBooking(body),
    onSuccess: (booking) => {
      qc.setQueryData(bookingKeys.detail(booking.id), booking);
      void qc.invalidateQueries({ queryKey: bookingKeys.listRoot });
    },
  });
}

/**
 * Wraps a booking action: on success the server's booking REPLACES the cached one
 * (the UI only ever shows what the server returned); on a conflict-type error the booking is
 * refetched because the server may already have committed a safe downgrade (e.g. approval cancelled).
 */
function useBookingAction<V>(bookingId: string, fn: (variables: V) => Promise<Booking>) {
  const qc = useQueryClient();
  return useMutation<Booking, unknown, V>({
    mutationFn: fn,
    onSuccess: (booking) => {
      qc.setQueryData(bookingKeys.detail(bookingId), booking);
      void qc.invalidateQueries({ queryKey: bookingKeys.listRoot });
    },
    onError: (err) => {
      if (isApiError(err) && (REFETCH_CODES.has(err.code) || err.status === 409 || err.status === 503)) {
        void qc.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) });
        void qc.invalidateQueries({ queryKey: bookingKeys.listRoot });
      }
    },
  });
}

export function useBookingActions(bookingId: string) {
  return {
    travelers: useBookingAction(bookingId, (ids: string[]) => updateTravelers(bookingId, ids)),
    revalidate: useBookingAction(bookingId, (_: void) => revalidateBooking(bookingId)),
    approve: useBookingAction(bookingId, (v: { terms_hash: string; password: string }) =>
      approveBooking(bookingId, { ...v, confirm: true }),
    ),
    submit: useBookingAction(bookingId, (key: string) => submitBooking(bookingId, key)),
    reconcile: useBookingAction(bookingId, (_: void) => reconcileBooking(bookingId)),
    cancel: useBookingAction(bookingId, (reason: string | undefined) => cancelBooking(bookingId, reason)),
    record: useBookingAction(bookingId, (v: { supplier_reference: string; notes?: string }) => recordConfirmation(bookingId, v)),
  };
}

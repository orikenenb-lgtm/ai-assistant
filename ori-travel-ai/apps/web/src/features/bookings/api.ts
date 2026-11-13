/** Booking preparation API (contract §3.5). Real booking execution is OFF on the server. */
import { api } from '@/lib/api';
import {
  BookingPageSchema,
  BookingSchema,
  CheckoutLinkSchema,
  DemoCheckoutSchema,
  type BookingCreateBody,
} from '@/lib/schemas/bookings';

export const bookingKeys = {
  all: ['bookings'] as const,
  list: (state: string | null, page: number) => ['bookings', 'list', state ?? 'all', page] as const,
  listRoot: ['bookings', 'list'] as const,
  detail: (id: string) => ['bookings', 'detail', id] as const,
};

const base = (id: string) => `/api/bookings/${encodeURIComponent(id)}`;

export const PAGE_SIZE = 20;

export const fetchBookings = (state: string | null, page: number) =>
  api.get('/api/bookings', { query: { state, page, page_size: PAGE_SIZE }, schema: BookingPageSchema });

export const fetchBooking = (id: string) => api.get(base(id), { schema: BookingSchema });

export const createBooking = (body: BookingCreateBody) => api.post('/api/bookings', body, { schema: BookingSchema });

export const updateTravelers = (id: string, traveler_member_ids: string[]) =>
  api.patch(`${base(id)}/travelers`, { traveler_member_ids }, { schema: BookingSchema });

export const revalidateBooking = (id: string) => api.post(`${base(id)}/revalidate`, undefined, { schema: BookingSchema });

/** `terms_hash` MUST be the hash of the booking the user was looking at when they confirmed. */
export const approveBooking = (id: string, body: { terms_hash: string; password: string; confirm: true }) =>
  api.post(`${base(id)}/approve`, body, { schema: BookingSchema });

export const submitBooking = (id: string, idempotency_key: string) =>
  api.post(`${base(id)}/submit`, { idempotency_key }, { schema: BookingSchema });

export const reconcileBooking = (id: string) => api.post(`${base(id)}/reconcile`, undefined, { schema: BookingSchema });

export const cancelBooking = (id: string, reason?: string) =>
  api.post(`${base(id)}/cancel`, reason ? { reason } : {}, { schema: BookingSchema });

export const recordConfirmation = (id: string, body: { supplier_reference: string; notes?: string }) =>
  api.post(`${base(id)}/record-confirmation`, body, { schema: BookingSchema });

// POST: revealing the link re-checks the price and may change state, so it is CSRF-protected.
export const fetchCheckoutLink = (id: string) => api.post(`${base(id)}/checkout-link`, undefined, { schema: CheckoutLinkSchema });

// ---- DEMO supplier page (in-app stand-in for a supplier's own site; no payment, no charge) ----

export const demoCheckoutKeys = {
  detail: (ref: string) => ['demo-supplier', 'checkout', ref] as const,
};

export const fetchDemoCheckout = (ref: string) => api.get('/api/demo-supplier/checkout', { query: { ref }, schema: DemoCheckoutSchema });

/** The DEMO supplier issues a reference. This does NOT confirm the booking — the reference must be recorded on it. */
export const completeDemoCheckout = (ref: string) => api.post('/api/demo-supplier/checkout/complete', { ref }, { schema: DemoCheckoutSchema });

import { BookingSchema, type Booking, type BookingCan } from '@/lib/schemas/bookings';
import { makeFlightOffer } from '@/features/offers/testFixtures';

export const NO_CAN: BookingCan = {
  edit_travelers: false,
  revalidate: false,
  approve: false,
  submit: false,
  reconcile: false,
  cancel: false,
  record_confirmation: false,
  open_checkout: false,
};

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);

type Over = Partial<Omit<Booking, 'can'>> & { can?: Partial<BookingCan> };

/** A contract-shaped booking payload (parsed through the real schema). */
export function makeBooking(over: Over = {}): Booking {
  const { can, ...rest } = over;
  return BookingSchema.parse({
    id: 'b1',
    state: 'READY_FOR_APPROVAL',
    state_label: 'ממתין לאישור',
    category: 'flight',
    title: 'תל אביב – אתונה',
    provider_id: 'demo_skyline',
    provider_name: 'דמו סקייליין',
    execution_mode: 'SIMULATION',
    is_simulation: true,
    current_price: { amount: '1000.00', currency: 'ILS' },
    price_changed: false,
    offer_expired: false,
    travelers_count: 2,
    supplier_reference: null,
    trip_id: null,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:05:00Z',
    offer_id: 'o1',
    offer: makeFlightOffer(),
    travelers: [
      { family_member_id: 'm1', display_name: 'אורי', age_group: 'adult', is_minor: false },
      { family_member_id: 'm2', display_name: 'נועה', age_group: 'child', is_minor: true },
    ],
    quoted_price: { amount: '1000.00', currency: 'ILS' },
    simulation_scenario: 'success',
    terms_hash: HASH_A,
    terms_summary: ['טיסה: תל אביב – אתונה, 20.12.2026', 'סה״כ לתשלום: ‏1,000.00 ₪', 'ביטול: ללא החזר כספי'],
    approval: null,
    history: [{ from: 'DRAFT', to: 'QUOTE_SELECTED', at: '2026-11-12T10:00:00Z', by: 'u1', by_name: 'אורי', reason: 'נוצרה הכנה להזמנה' }],
    failure_reason: null,
    reservation: null,
    revalidated_at: '2026-11-12T10:04:00Z',
    revalidation_fresh: true,
    offer_expires_at: '2099-01-01T00:00:00Z',
    submitted_at: null,
    version: 1,
    warnings: ['מצב סימולציה: נתוני הדגמה בלבד. לא תתבצע הזמנה אמיתית ולא יבוצע חיוב.'],
    notice: null,
    idempotent_replay: false,
    ...rest,
    can: { ...NO_CAN, ...can },
  });
}

export const approvedApproval = {
  id: 'ap1',
  approved_by_id: 'u1',
  approved_by: 'אורי',
  approved_at: '2026-11-12T10:06:00Z',
  expires_at: '2099-01-01T00:00:00Z',
  amount: { amount: '1000.00', currency: 'ILS' },
  terms_hash: HASH_A,
  valid: true,
  invalidated_at: null,
  invalidation_reason: null,
  consumed_at: null,
};

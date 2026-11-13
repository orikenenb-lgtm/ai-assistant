import { CanonicalOfferSchema, type CanonicalOffer } from '@/lib/schemas/offers';

export function makeFlightOffer(over: Partial<{ id: string; amount: string; stops: number; refundable: boolean | null; rank: number; excluded: boolean }> = {}): CanonicalOffer {
  const { id = 'o1', amount = '1000.00', stops = 0, refundable = false, rank = 1, excluded = false } = over;
  return CanonicalOfferSchema.parse({
    id,
    category: 'flight',
    title: `תל אביב – אתונה ${id}`,
    subtitle: 'חברה (דמו) · הלוך-חזור',
    source: {
      provider_id: 'demo_skyline',
      provider_name: 'דמו סקייליין',
      mode: 'DEMO',
      fetched_at: '2026-11-12T10:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      supplier_offer_id: `S-${id}`,
    },
    price: {
      total: { amount, currency: 'ILS' },
      components: [
        { label: 'תעריף בסיס', kind: 'base', amount: { amount, currency: 'ILS' }, status: 'known', included_in_total: true },
        ...(excluded ? [{ label: 'מס עירוני', kind: 'tax', amount: { amount: '16.00', currency: 'EUR' }, status: 'excluded', included_in_total: false }] : []),
      ],
      excluded_notes: excluded ? ['המס משולם במלון'] : [],
      per_person: { amount: '500.00', currency: 'ILS' },
    },
    cancellation: { refundable, free_cancellation_until: null, changeable: true, change_fee: { amount: '270.00', currency: 'ILS' } },
    details: {
      kind: 'flight',
      slices: [
        {
          origin: 'TLV',
          destination: 'ATH',
          departing_at: '2026-12-20T16:45:00+02:00',
          arriving_at: '2026-12-20T18:45:00+02:00',
          duration_minutes: 120,
          stops,
          segments: [
            {
              carrier_code: 'D1',
              carrier_name: 'אוריון אייר (דמו)',
              flight_number: '313',
              origin: 'TLV',
              destination: 'ATH',
              departing_at: '2026-12-20T16:45:00+02:00',
              arriving_at: '2026-12-20T18:45:00+02:00',
              duration_minutes: 120,
              cabin: 'economy',
            },
          ],
          layovers_minutes: [],
        },
      ],
      cabin: 'economy',
      baggage: { personal_item: true, carry_on_included: 1, checked_included: 0 },
      passengers: { adult: 2 },
      total_duration_minutes: 120,
      max_stops: stops,
    },
    dedupe_key: id,
    also_offered_by: ['דמו אורורה'],
    score: {
      total: '83.0',
      cost: '100',
      convenience: '100.0',
      flexibility: '45',
      quality: '60.0',
      weights: { cost: 40, convenience: 25, flexibility: 20, quality: 15 },
      reasons: ['טיסות ישירות'],
      rank,
      comparable: true,
    },
  });
}

import { describe, expect, it } from 'vitest';
import { CanonicalOfferSchema, type CanonicalOffer } from '@/lib/schemas/offers';
import { EMPTY_FILTERS, activeFilterCount, filterOffers, sortOffers } from './filters';

function flight(id: string, amount: string, rank: number, stops: number, duration: number, checked = 0): CanonicalOffer {
  return CanonicalOfferSchema.parse({
    id,
    category: 'flight',
    title: id,
    source: { provider_id: 'p1', provider_name: 'ספק', mode: 'DEMO', fetched_at: '2026-11-12T10:00:00Z', supplier_offer_id: id },
    price: { total: { amount, currency: 'ILS' } },
    cancellation: { refundable: stops === 0 ? true : false },
    details: {
      kind: 'flight',
      slices: [],
      cabin: 'economy',
      baggage: { personal_item: true, carry_on_included: 1, checked_included: checked },
      passengers: { adult: 1 },
      total_duration_minutes: duration,
      max_stops: stops,
    },
    dedupe_key: id,
    score: { total: '50', cost: '50', convenience: '50', flexibility: '50', quality: '50', weights: { cost: 40 }, rank },
  });
}

const offers = [flight('a', '1000.50', 3, 0, 200, 1), flight('b', '999.99', 1, 1, 300), flight('c', '2000', 2, 2, 150)];

describe('sortOffers', () => {
  it('sorts by score rank, exact price, duration and stops', () => {
    expect(sortOffers(offers, 'score').map((o) => o.id)).toEqual(['b', 'c', 'a']);
    expect(sortOffers(offers, 'price').map((o) => o.id)).toEqual(['b', 'a', 'c']);
    expect(sortOffers(offers, 'duration').map((o) => o.id)).toEqual(['c', 'a', 'b']);
    expect(sortOffers(offers, 'stops').map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('filterOffers', () => {
  it('filters by stops, bag, price and refundability', () => {
    expect(filterOffers(offers, { ...EMPTY_FILTERS, maxStops: '1' }, 'ILS').map((o) => o.id)).toEqual(['a', 'b']);
    expect(filterOffers(offers, { ...EMPTY_FILTERS, checkedBag: true }, 'ILS').map((o) => o.id)).toEqual(['a']);
    expect(filterOffers(offers, { ...EMPTY_FILTERS, maxPrice: '1000' }, 'ILS').map((o) => o.id)).toEqual(['b']);
    expect(filterOffers(offers, { ...EMPTY_FILTERS, freeCancellation: true }, 'ILS').map((o) => o.id)).toEqual(['a']);
  });
  it('counts active filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, maxStops: '0', checkedBag: true })).toBe(2);
  });
});

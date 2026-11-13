import { describe, expect, it } from 'vitest';
import { CanonicalOfferSchema, type CanonicalOffer } from '@/lib/schemas/offers';
import { EMPTY_FILTERS, activeFilterCount, departWindowOf, filterOffers, filterOptions, sortOffers } from './filters';

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

function timed(id: string, departs: string, cabin = 'economy', checked = 0): CanonicalOffer {
  const base = flight(id, '1000', 1, 0, 120, checked);
  return CanonicalOfferSchema.parse({
    ...base,
    details: {
      ...base.details,
      cabin,
      slices: [
        {
          origin: 'TLV',
          destination: 'FCO',
          departing_at: departs,
          arriving_at: departs,
          duration_minutes: 120,
          stops: 0,
          segments: [],
        },
      ],
    },
  });
}

describe('V6 flight filters', () => {
  const list = [
    timed('m', '2026-12-10T06:30:00+02:00', 'economy', 1),
    timed('a', '2026-12-10T13:00:00+02:00', 'business'),
    timed('e', '2026-12-10T19:15:00+02:00'),
    timed('n', '2026-12-10T23:40:00+02:00'),
  ];

  it('classifies the outbound departure by the airport local time', () => {
    expect(departWindowOf('2026-12-10T04:59:00+02:00')).toBe('night');
    expect(departWindowOf('2026-12-10T05:00:00+02:00')).toBe('morning');
    expect(departWindowOf('2026-12-10T12:00:00-05:00')).toBe('afternoon');
    expect(departWindowOf(null)).toBeNull();
  });

  it('"כולל מזוודה לבטן", departure window and cabin filters', () => {
    expect(filterOffers(list, { ...EMPTY_FILTERS, checkedBag: true }, 'ILS').map((o) => o.id)).toEqual(['m']);
    expect(filterOffers(list, { ...EMPTY_FILTERS, departWindow: 'evening' }, 'ILS').map((o) => o.id)).toEqual(['e']);
    expect(filterOffers(list, { ...EMPTY_FILTERS, departWindow: 'night' }, 'ILS').map((o) => o.id)).toEqual(['n']);
    expect(filterOffers(list, { ...EMPTY_FILTERS, cabin: 'business' }, 'ILS').map((o) => o.id)).toEqual(['a']);
    expect(activeFilterCount({ ...EMPTY_FILTERS, departWindow: 'morning', cabin: 'economy' })).toBe(2);
  });

  it('offers cabin/window options with counts from the results', () => {
    const o = filterOptions(list);
    expect(o.cabins).toEqual([
      { value: 'economy', count: 3 },
      { value: 'business', count: 1 },
    ]);
    expect(o.windows.get('morning')).toBe(1);
  });

  it('sorts by departure time (local wall clock)', () => {
    expect(sortOffers([list[2], list[0], list[3], list[1]], 'departure').map((o) => o.id)).toEqual(['m', 'a', 'e', 'n']);
  });
});

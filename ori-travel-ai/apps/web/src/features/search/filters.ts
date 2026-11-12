/** Client-side sort + quick filters over an already-fetched search result. Pure functions (unit-tested). */
import { compareDecimal } from '@/features/offers/decimal';
import type { Category } from '@/lib/schemas/common';
import type { CanonicalOffer } from '@/lib/schemas/offers';

export type SortKey = 'score' | 'price' | 'duration' | 'stops' | 'rating' | 'distance' | 'stars' | 'seats';

export const SORT_OPTIONS: Record<Category, Array<{ key: SortKey; label: string }>> = {
  flight: [
    { key: 'score', label: 'דירוג (מומלץ)' },
    { key: 'price', label: 'מחיר: מהזול ליקר' },
    { key: 'duration', label: 'משך טיסה: מהקצר לארוך' },
    { key: 'stops', label: 'מספר עצירות' },
  ],
  hotel: [
    { key: 'score', label: 'דירוג (מומלץ)' },
    { key: 'price', label: 'מחיר: מהזול ליקר' },
    { key: 'rating', label: 'דירוג אורחים' },
    { key: 'distance', label: 'מרחק מהמרכז' },
    { key: 'stars', label: 'כוכבים' },
  ],
  car: [
    { key: 'score', label: 'דירוג (מומלץ)' },
    { key: 'price', label: 'מחיר: מהזול ליקר' },
    { key: 'seats', label: 'מספר מקומות' },
  ],
  activity: [
    { key: 'score', label: 'דירוג (מומלץ)' },
    { key: 'price', label: 'מחיר: מהזול ליקר' },
    { key: 'rating', label: 'דירוג משתתפים' },
    { key: 'duration', label: 'משך הפעילות' },
  ],
};

function rankOf(o: CanonicalOffer): number {
  return o.score?.rank ?? Number.MAX_SAFE_INTEGER;
}

/** Ascending numeric key with nulls last. */
function asc(get: (o: CanonicalOffer) => number | null | undefined) {
  return (a: CanonicalOffer, b: CanonicalOffer) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  };
}
function desc(get: (o: CanonicalOffer) => number | null | undefined) {
  const up = asc(get);
  return (a: CanonicalOffer, b: CanonicalOffer) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return up(a, b);
    return y - x;
  };
}

export function sortOffers(offers: CanonicalOffer[], key: SortKey): CanonicalOffer[] {
  const byRank = (a: CanonicalOffer, b: CanonicalOffer) => rankOf(a) - rankOf(b);
  let primary: (a: CanonicalOffer, b: CanonicalOffer) => number;
  switch (key) {
    case 'price':
      primary = (a, b) =>
        a.price.total.currency === b.price.total.currency ? compareDecimal(a.price.total.amount, b.price.total.amount) : 0;
      break;
    case 'duration':
      primary = asc((o) => (o.details.kind === 'flight' ? o.details.total_duration_minutes : o.details.kind === 'activity' ? o.details.duration_minutes : null));
      break;
    case 'stops':
      primary = asc((o) => (o.details.kind === 'flight' ? o.details.max_stops : null));
      break;
    case 'rating':
      primary = desc((o) => (o.details.kind === 'hotel' ? o.details.guest_rating : o.details.kind === 'activity' ? o.details.rating : null));
      break;
    case 'distance':
      primary = asc((o) => (o.details.kind === 'hotel' ? o.details.distance_to_center_km : null));
      break;
    case 'stars':
      primary = desc((o) => (o.details.kind === 'hotel' ? o.details.star_rating : null));
      break;
    case 'seats':
      primary = desc((o) => (o.details.kind === 'car' ? o.details.seats : null));
      break;
    default:
      primary = byRank;
  }
  return offers
    .map((o, i) => ({ o, i }))
    .sort((a, b) => primary(a.o, b.o) || byRank(a.o, b.o) || a.i - b.i)
    .map((x) => x.o);
}

export interface OfferFilters {
  maxPrice: string;
  freeCancellation: boolean;
  providers: string[];
  // flights
  maxStops: '' | '0' | '1';
  checkedBag: boolean;
  carriers: string[];
  // hotels
  minStars: number;
  minGuestRating: number;
  minBoard: '' | 'breakfast' | 'half_board' | 'all_inclusive';
  kosherInfo: boolean;
  accessible: boolean;
  // cars
  transmission: '' | 'manual' | 'automatic';
  minSeats: number;
  // activities
  familyFriendly: boolean;
  minRating: number;
}

export const EMPTY_FILTERS: OfferFilters = {
  maxPrice: '',
  freeCancellation: false,
  providers: [],
  maxStops: '',
  checkedBag: false,
  carriers: [],
  minStars: 0,
  minGuestRating: 0,
  minBoard: '',
  kosherInfo: false,
  accessible: false,
  transmission: '',
  minSeats: 0,
  familyFriendly: false,
  minRating: 0,
};

const BOARD_RANK: Record<string, number> = { room_only: 0, breakfast: 1, half_board: 2, full_board: 3, all_inclusive: 4 };
const MIN_BOARD_RANK: Record<string, number> = { breakfast: 1, half_board: 2, all_inclusive: 4 };

export function carriersOf(o: CanonicalOffer): string[] {
  return o.details.kind === 'flight' ? [...new Set(o.details.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))] : [];
}

export function activeFilterCount(f: OfferFilters): number {
  let n = 0;
  if (f.maxPrice.trim()) n++;
  if (f.freeCancellation) n++;
  if (f.providers.length) n++;
  if (f.maxStops) n++;
  if (f.checkedBag) n++;
  if (f.carriers.length) n++;
  if (f.minStars) n++;
  if (f.minGuestRating) n++;
  if (f.minBoard) n++;
  if (f.kosherInfo) n++;
  if (f.accessible) n++;
  if (f.transmission) n++;
  if (f.minSeats) n++;
  if (f.familyFriendly) n++;
  if (f.minRating) n++;
  return n;
}

export function filterOffers(offers: CanonicalOffer[], f: OfferFilters, currency: string): CanonicalOffer[] {
  const maxPrice = f.maxPrice.trim();
  return offers.filter((o) => {
    if (maxPrice && /^\d+(\.\d+)?$/.test(maxPrice) && o.price.total.currency === currency && compareDecimal(o.price.total.amount, maxPrice) > 0) {
      return false;
    }
    if (f.freeCancellation && o.cancellation.refundable !== true) return false;
    if (f.providers.length && !f.providers.includes(o.source.provider_id)) return false;
    const d = o.details;
    switch (d.kind) {
      case 'flight':
        if (f.maxStops !== '' && d.max_stops > Number(f.maxStops)) return false;
        if (f.checkedBag && !((d.baggage.checked_included ?? 0) > 0)) return false;
        if (f.carriers.length && !carriersOf(o).some((c) => f.carriers.includes(c))) return false;
        break;
      case 'hotel':
        if (f.minStars && !((d.star_rating ?? 0) >= f.minStars)) return false;
        if (f.minGuestRating && !((d.guest_rating ?? 0) >= f.minGuestRating)) return false;
        if (f.minBoard && (BOARD_RANK[d.board] ?? 0) < MIN_BOARD_RANK[f.minBoard]) return false;
        if (f.kosherInfo && !d.kosher_info) return false;
        if (f.accessible && d.accessibility_features.length === 0) return false;
        break;
      case 'car':
        if (f.transmission && d.transmission !== f.transmission) return false;
        if (f.minSeats && d.seats < f.minSeats) return false;
        break;
      case 'activity':
        if (f.familyFriendly && d.family_friendly !== true) return false;
        if (f.minRating && !((d.rating ?? 0) >= f.minRating)) return false;
        if (f.accessible && d.accessibility_features.length === 0) return false;
        break;
    }
    return true;
  });
}

export function filterOptions(offers: CanonicalOffer[]) {
  const providers = new Map<string, string>();
  const carriers = new Set<string>();
  for (const o of offers) {
    providers.set(o.source.provider_id, o.source.provider_name);
    for (const c of carriersOf(o)) carriers.add(c);
  }
  return {
    providers: [...providers].map(([id, name]) => ({ id, name })),
    carriers: [...carriers].sort((a, b) => a.localeCompare(b, 'he')),
  };
}

/**
 * Featured-deal helpers (pure, unit-tested). The featured offer is ALWAYS one of the offers the search returned —
 * never an invented price — and is described as "the cheapest among the offers found in this search", not as the
 * cheapest in the market.
 */
import type { CanonicalOffer } from '@/lib/schemas/offers';
import type { SearchHighlights } from '@/lib/schemas/search';
import { compareDecimal } from './decimal';

/** Currency shared by most offers (ties → the first seen). Prices are only compared within one currency. */
export function dominantCurrency(offers: readonly CanonicalOffer[]): string | null {
  const counts = new Map<string, number>();
  for (const o of offers) counts.set(o.price.total.currency, (counts.get(o.price.total.currency) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** Cheapest KNOWN total among offers in the dominant currency; ties go to the better rank. */
export function cheapestOffer(offers: readonly CanonicalOffer[]): CanonicalOffer | null {
  const currency = dominantCurrency(offers);
  if (!currency) return null;
  let best: CanonicalOffer | null = null;
  for (const o of offers) {
    if (o.price.total.currency !== currency) continue;
    if (!best) {
      best = o;
      continue;
    }
    const cmp = compareDecimal(o.price.total.amount, best.price.total.amount);
    const rankO = o.score?.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = best.score?.rank ?? Number.MAX_SAFE_INTEGER;
    if (cmp < 0 || (cmp === 0 && rankO < rankB)) best = o;
  }
  return best;
}

export interface FeaturedPick {
  offer: CanonicalOffer;
  /** "server": from `highlights.cheapest_offer_id`; "client": derived here (older server, or filters applied). */
  source: 'server' | 'client';
  /** The pick reflects the user's client-side filters. */
  filtered: boolean;
  /** Number of offers it was compared against (same currency). */
  comparableCount: number;
  note: string | null;
}

export const FEATURED_DEFAULT_NOTE = 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (באותו מטבע) — לא בהכרח המחיר הנמוך ביותר בשוק.';
export const FEATURED_FILTERED_NOTE =
  'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה ותואמות את המסננים שבחרתם (באותו מטבע) — לא בהכרח המחיר הנמוך ביותר בשוק.';

/**
 * Chooses the featured offer.
 * - No client filters: the server's highlight (falls back to a client-side pick over the same offers).
 * - Client filters active: the cheapest among the VISIBLE offers, labelled as such.
 */
export function pickFeatured(
  all: readonly CanonicalOffer[],
  visible: readonly CanonicalOffer[],
  highlights: SearchHighlights | null | undefined,
  filtersActive: boolean,
): FeaturedPick | null {
  if (filtersActive) {
    const offer = cheapestOffer(visible);
    if (!offer) return null;
    const currency = offer.price.total.currency;
    return {
      offer,
      source: 'client',
      filtered: true,
      comparableCount: visible.filter((o) => o.price.total.currency === currency).length,
      note: FEATURED_FILTERED_NOTE,
    };
  }
  const fromServer = highlights?.cheapest_offer_id ? all.find((o) => o.id === highlights.cheapest_offer_id) : undefined;
  if (fromServer) {
    return {
      offer: fromServer,
      source: 'server',
      filtered: false,
      comparableCount: highlights?.comparable_count || all.filter((o) => o.price.total.currency === fromServer.price.total.currency).length,
      note: highlights?.note?.trim() || FEATURED_DEFAULT_NOTE,
    };
  }
  const offer = cheapestOffer(all);
  if (!offer) return null;
  const currency = offer.price.total.currency;
  return {
    offer,
    source: 'client',
    filtered: false,
    comparableCount: all.filter((o) => o.price.total.currency === currency).length,
    note: FEATURED_DEFAULT_NOTE,
  };
}

/** Number of travellers the price covers, from the offer itself (flight passengers / activity participants). */
export function travellersCovered(offer: CanonicalOffer): number | null {
  const d = offer.details;
  const counts = d.kind === 'flight' ? d.passengers : d.kind === 'activity' ? d.participants : null;
  if (!counts) return null;
  const n = Object.values(counts).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  return n > 0 ? n : null;
}

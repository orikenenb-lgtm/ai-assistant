import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CanonicalOfferSchema, type CanonicalOffer } from '@/lib/schemas/offers';
import { renderWithProviders } from '@/test/utils';
import { FEATURED_DEFAULT_NOTE, FEATURED_FILTERED_NOTE, cheapestOffer, dominantCurrency, pickFeatured, travellersCovered } from '../featured';
import { makeFlightOffer } from '../testFixtures';
import { FeaturedDeal } from './FeaturedDeal';

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/[‎‏]/g, '').replace(/ /g, ' ');

function withCurrency(o: CanonicalOffer, currency: string, amount: string): CanonicalOffer {
  return CanonicalOfferSchema.parse({ ...o, price: { ...o.price, total: { amount, currency } } });
}

describe('featured pick', () => {
  const a = makeFlightOffer({ id: 'a', amount: '1200.00', rank: 2 });
  const b = makeFlightOffer({ id: 'b', amount: '999.99', rank: 3 });
  const c = makeFlightOffer({ id: 'c', amount: '999.99', rank: 1 });
  const eur = withCurrency(makeFlightOffer({ id: 'e', rank: 4 }), 'EUR', '10.00');

  it('compares exact decimal strings within the dominant currency only; ties go to the better rank', () => {
    expect(dominantCurrency([a, b, eur])).toBe('ILS');
    expect(cheapestOffer([a, b, c, eur])?.id).toBe('c');
    expect(cheapestOffer([])).toBeNull();
  });

  it('uses the server highlight when there are no client filters', () => {
    const pick = pickFeatured([a, b, c], [a, b, c], { currency: 'ILS', cheapest_offer_id: 'b', comparable_count: 3, note: 'הערת שרת' }, false);
    expect(pick).toMatchObject({ source: 'server', filtered: false, comparableCount: 3, note: 'הערת שרת' });
    expect(pick?.offer.id).toBe('b');
  });

  it('falls back to a client pick over the same offers (older server)', () => {
    const pick = pickFeatured([a, b, c], [a, b, c], undefined, false);
    expect(pick).toMatchObject({ source: 'client', filtered: false, note: FEATURED_DEFAULT_NOTE });
    expect(pick?.offer.id).toBe('c');
  });

  it('follows the visible offers when filters are active', () => {
    const pick = pickFeatured([a, b, c], [a], { currency: 'ILS', cheapest_offer_id: 'c', comparable_count: 3 }, true);
    expect(pick).toMatchObject({ filtered: true, note: FEATURED_FILTERED_NOTE });
    expect(pick?.offer.id).toBe('a');
    expect(pickFeatured([a], [], null, true)).toBeNull();
  });

  it('counts travellers from the offer itself', () => {
    expect(travellersCovered(a)).toBe(2);
  });
});

describe('FeaturedDeal', () => {
  const offer = makeFlightOffer({ id: 'o9', amount: '2421.73' });

  it('says "cheapest among the offers found in this search", shows total vs per person and the offer facts', async () => {
    const onReview = vi.fn();
    renderWithProviders(
      <FeaturedDeal
        pick={{ offer, source: 'server', filtered: false, comparableCount: 7, note: 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (מטבע זהה) — לא בהכרח בכל השוק' }}
        onReview={onReview}
        placeName={(c) => ({ TLV: 'תל אביב', ATH: 'אתונה' })[c]}
      />,
    );
    const panel = screen.getByTestId('featured-deal');
    expect(within(panel).getByRole('heading', { name: 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה' })).toBeInTheDocument();
    expect(text(panel)).not.toMatch(/הטיסה הזולה ביותר/);
    expect(text(screen.getByTestId('featured-total'))).toContain('2,421.73 ₪');
    expect(text(panel)).toContain('סה״כ ל-2 נוסעים');
    expect(text(screen.getByTestId('featured-per-person'))).toContain('500.00 ₪ לנוסע');
    expect(text(panel)).toContain('אוריון אייר (דמו)');
    expect(text(panel)).toContain('תל אביב');
    expect(text(panel)).toContain('אתונה');
    expect(text(panel)).toContain('ללא מזוודה לבטן');
    expect(text(panel)).toContain('דמו סקייליין');
    expect(within(panel).getByText('הדגמה')).toBeInTheDocument();
    expect(text(screen.getByTestId('featured-note'))).toContain('לא בהכרח בכל השוק');
    expect(text(screen.getByTestId('featured-note'))).toContain('נבדקו 7 הצעות');

    await userEvent.setup().click(within(panel).getByRole('button', { name: 'בדיקת ההצעה' }));
    expect(onReview).toHaveBeenCalledWith(offer);
  });

  it('labels a filtered pick as such', () => {
    renderWithProviders(<FeaturedDeal pick={{ offer, source: 'client', filtered: true, comparableCount: 1, note: FEATURED_FILTERED_NOTE }} onReview={() => {}} />);
    expect(screen.getByRole('heading', { name: 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה ותואמות את המסננים' })).toBeInTheDocument();
    expect(screen.getByText('הזול ביותר לפי המסננים')).toBeInTheDocument();
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CanonicalOfferSchema } from '@/lib/schemas/offers';
import { renderWithProviders } from '@/test/utils';
import { countLabel, passengersText } from '../index';
import { makeFlightOffer } from '../testFixtures';
import { OfferTable } from './OfferTable';

const clean = (s: string | null) => (s ?? '').replace(/[‎‏]/g, '').replace(/ /g, ' ');

const withBag = CanonicalOfferSchema.parse({
  ...makeFlightOffer({ id: 'b2', amount: '1500.00', refundable: true, rank: 2 }),
  details: { ...makeFlightOffer().details, baggage: { personal_item: true, carry_on_included: 1, checked_included: 1, checked_bag_weight_kg: 23 } },
});
const offers = [makeFlightOffer({ id: 'a1', amount: '1000.00', rank: 1 }), withBag];

describe('OfferTable', () => {
  it('renders a semantic table from the offers (caption, row headers, every column from data)', async () => {
    const onOpen = vi.fn();
    const onSort = vi.fn();
    const onMap = vi.fn();
    renderWithProviders(
      <OfferTable offers={offers} category="flight" caption="טבלת השוואה: 2 טיסות" sort="price" onSort={onSort} onOpenDetails={onOpen} featuredId="a1" onShowOnMap={onMap} />,
    );
    const table = screen.getByRole('table', { name: 'טבלת השוואה: 2 טיסות' });
    expect(table).toHaveAttribute('data-testid', 'results-table');
    const headers = within(table).getAllByRole('columnheader').map((h) => clean(h.textContent));
    expect(headers.slice(0, 8)).toEqual(['חברה וספק', expect.stringContaining('מסלול'), expect.stringContaining('סה״כ'), 'לנוסע', 'כבודה', 'ביטול', 'נבדק', 'מקור']);
    expect(within(table).getByRole('columnheader', { name: /סה״כ/ })).toHaveAttribute('aria-sort', 'ascending');

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = clean(rows[0].textContent);
    expect(first).toContain('הזול בחיפוש');
    expect(first).toContain('אוריון אייר (דמו)');
    expect(first).toContain('דמו סקייליין');
    expect(first).toContain('1,000.00 ₪');
    expect(first).toContain('500.00 ₪');
    expect(first).toContain('ללא מזוודה לבטן');
    expect(first).toContain('ללא החזר');
    expect(first).toContain('הדגמה');
    expect(first).toContain('16:45');
    expect(first).toContain('ישירה');
    const second = clean(rows[1].textContent);
    expect(second).toContain('מזוודה לבטן (23 ק״ג)');
    expect(second).toContain('ניתן להחזר');
    expect(rows[1]).not.toHaveAttribute('data-featured');

    const user = userEvent.setup();
    await user.click(within(rows[1]).getByRole('button', { name: /^פרטים/ }));
    expect(onOpen).toHaveBeenCalledWith(withBag);
    await user.click(within(table).getByRole('button', { name: /מסלול/ }));
    expect(onSort).toHaveBeenCalledWith('duration');
    await user.click(within(rows[0]).getByRole('button', { name: /הצגת המסלול במפה/ }));
    expect(onMap).toHaveBeenCalledWith(offers[0]);
  });
});

describe('Hebrew counts (BUG-QA-06)', () => {
  it('uses the singular for one and the number + plural otherwise', () => {
    expect(countLabel(1, 'חדר אחד', 'חדרים')).toBe('חדר אחד');
    expect(countLabel(2, 'חדר אחד', 'חדרים')).toBe('2 חדרים');
    expect(passengersText({ adult: 1, child: 2, infant: 0 })).toBe('מבוגר אחד, 2 ילדים');
  });
});

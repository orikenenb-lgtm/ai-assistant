import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeFlightOffer } from '@/features/offers/testFixtures';
import type { ComparisonGroup } from '@/lib/schemas/offers';
import { renderWithProviders } from '@/test/utils';
import { ComparisonTable } from './ComparisonTable';
import { bestBy } from './rows';

const a = makeFlightOffer({ id: 'a', amount: '999.99', rank: 1, stops: 0 });
const b = makeFlightOffer({ id: 'b', amount: '1000.50', rank: 2, stops: 1 });
const group: ComparisonGroup = { category: 'flight', currency: 'ILS', offers: [a, b], cheapest_offer_id: 'a', display_conversions: {} };

describe('ComparisonTable', () => {
  it('highlights the best value per row and labels it for screen readers', () => {
    renderWithProviders(<ComparisonTable group={group} showFx={false} caption="טבלה" onRemove={() => {}} />);
    const total = screen.getByTestId('comparison-table').querySelector('[data-row=total]') as HTMLElement;
    const cells = within(total).getAllByRole('cell');
    expect(cells[0]).toHaveAttribute('data-best', 'true');
    expect(cells[0]).toHaveTextContent('הטוב ביותר');
    expect(cells[1]).not.toHaveAttribute('data-best');
    expect(screen.getByText('הזול ביותר')).toBeInTheDocument();
  });

  it('only shows FX rows when requested and labels them display-only', () => {
    const withFx: ComparisonGroup = {
      ...group,
      display_conversions: {
        a: { original: a.price.total, converted: { amount: '270.00', currency: 'USD' }, rate: '0.27', rate_source: 'דמו', rate_mode: 'DEMO', rate_timestamp: '2026-01-01T00:00:00Z' },
      },
    };
    const { rerender } = renderWithProviders(<ComparisonTable group={withFx} showFx={false} caption="t" onRemove={() => {}} />);
    expect(document.querySelector('[data-row=fx]')).toBeNull();
    rerender(<ComparisonTable group={withFx} showFx caption="t" onRemove={() => {}} />);
    expect(document.querySelector('[data-row=fx]')).toHaveTextContent('לתצוגה בלבד');
  });
});

describe('bestBy', () => {
  it('returns nothing when everyone ties', () => {
    expect(bestBy([a, b], () => 1, (x, y) => x - y).size).toBe(0);
    expect([...bestBy([a, b], (o) => (o.id === 'a' ? 1 : 2), (x, y) => x - y)]).toEqual(['a']);
  });
});

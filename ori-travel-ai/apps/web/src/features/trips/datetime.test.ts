import { describe, expect, it } from 'vitest';
import { isZeroAmount, normalizeAmount, toLocalInput } from './datetime';
import { validateTripForm } from './components/TripFormDialog';

describe('trip datetime helpers', () => {
  it('renders an instant as wall clock in the given zone', () => {
    expect(toLocalInput('2026-12-20T10:00:00Z', 'Europe/Rome')).toBe('2026-12-20T11:00');
    expect(toLocalInput('2026-12-20T10:00:00Z', 'Asia/Jerusalem')).toBe('2026-12-20T12:00');
    expect(toLocalInput(null, 'UTC')).toBe('');
  });
  it('normalizes amounts without floats', () => {
    expect(normalizeAmount('12,50')).toBe('12.50');
    expect(normalizeAmount('abc')).toBeNull();
    expect(normalizeAmount('-3')).toBeNull();
    expect(isZeroAmount('0.00')).toBe(true);
    expect(isZeroAmount('0.01')).toBe(false);
  });
  it('validates the trip form', () => {
    const f = { title: '', destination: '', start_date: '2026-12-10', end_date: '2026-12-01', timezone: '', budgetAmount: 'x', budgetCurrency: 'ILS', notes: '', status: 'planning', traveler_ids: [] };
    const e = validateTripForm(f);
    expect(Object.keys(e).sort()).toEqual(['budget', 'end_date', 'title']);
  });
});

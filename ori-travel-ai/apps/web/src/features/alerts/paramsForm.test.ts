import { describe, expect, it } from 'vitest';
import { buildSearchParams, EMPTY_PARAMS, intervalLabel, stateFromParams, validateParams } from './paramsForm';
import { sparkPath, sparkPoints } from './components/Sparkline';

describe('alert params form', () => {
  it('validates flight fields and future dates', () => {
    const e = validateParams('flight', { ...EMPTY_PARAMS, origin: 'TL', destination: 'ATH', start: '2020-01-01' }, '2026-11-12');
    expect(e.origin).toBeTruthy();
    expect(e.start).toMatch(/היום או בעתיד/);
    expect(validateParams('flight', { ...EMPTY_PARAMS, origin: 'tlv', destination: 'ath', start: '2026-12-01', end: '2026-12-08' }, '2026-11-12')).toEqual({});
  });
  it('rejects return before departure and same airports', () => {
    const base = { ...EMPTY_PARAMS, origin: 'TLV', destination: 'TLV', start: '2026-12-10', end: '2026-12-01' };
    expect(validateParams('flight', base, '2026-11-12').destination).toBeTruthy();
    expect(validateParams('flight', { ...base, destination: 'ATH' }, '2026-11-12').end).toBeTruthy();
  });
  it('round-trips a stored search and keeps unknown keys', () => {
    const stored = { category: 'flight', origin: 'TLV', destination: 'FCO', depart_date: '2026-12-20', return_date: null, adults: 2, children_ages: [4], currency: 'EUR' };
    const state = stateFromParams('flight', stored);
    expect(state.currency).toBe('EUR');
    const built = buildSearchParams('flight', state, stored);
    expect(built).toMatchObject({ origin: 'TLV', depart_date: '2026-12-20', children_ages: [4], currency: 'EUR', adults: 2 });
  });
  it('labels intervals', () => {
    expect(intervalLabel(360)).toBe('כל 6 שעות');
    expect(intervalLabel(2880)).toBe('כל 2 ימים');
  });
});

describe('sparkline', () => {
  const snap = (price: string, at: string, status = 'OK') => ({ id: at, status, captured_at: at, price: { amount: price, currency: 'ILS' } });
  it('keeps only OK points in the currency, oldest first', () => {
    const pts = sparkPoints([snap('120', '2026-01-02T00:00:00Z'), snap('100', '2026-01-01T00:00:00Z'), snap('1', '2026-01-03T00:00:00Z', 'FAILED')], 'ILS');
    expect(pts.map((p) => p.value)).toEqual([100, 120]);
    expect(sparkPath(pts, 160, 40)).toMatch(/^M/);
  });
});

import { describe, expect, it } from 'vitest';
import type { FareCalendarResponse, FareCell } from '@/lib/schemas/calendar';
import {
  cheapestCell,
  cheapestDays,
  googleFlightsUrl,
  heatColor,
  rankFractions,
  monthRows,
  savingVsAverage,
  weekdayDayMonth,
} from './model';

function cell(date: string, amount: number | null, extra: Partial<FareCell> = {}): FareCell {
  return {
    depart_date: date,
    return_date: null,
    nights: null,
    status: amount === null ? 'no_offers' : 'priced',
    min_total: amount === null ? null : { amount: amount.toFixed(2), currency: 'ILS' },
    travelers: 2,
    mode: amount === null ? null : 'DEMO',
    ...extra,
  };
}

function scan(cells: FareCell[], stats: Partial<FareCalendarResponse['stats']> = {}): FareCalendarResponse {
  return {
    origin: 'TLV',
    destination: 'ATH',
    currency: 'ILS',
    depart_dates: cells.map((c) => c.depart_date),
    trip_nights: [null],
    cells,
    stats: { priced: cells.filter((c) => c.status === 'priced').length, no_offers: 0, not_searched: 0, error: 0, ...stats },
    sources: [],
    has_demo: true,
  };
}

describe('heatColor / rankFractions', () => {
  it('maps cheapest rank to sky and most expensive to red', () => {
    expect(heatColor(0)).toBe('#4dabf7');
    expect(heatColor(1)).toBe('#f03e3e');
    expect(heatColor(0.5)).toBe('#ffd43b');
  });
  it('ranks distinct amounts evenly and ties share a rank', () => {
    const r = rankFractions([300, 100, 200, 100]);
    expect(r.get(100)).toBe(0);
    expect(r.get(200)).toBe(0.5);
    expect(r.get(300)).toBe(1);
    expect(rankFractions([50]).get(50)).toBe(0);
  });
});

describe('monthRows', () => {
  it('groups cells by month and places them by day of month', () => {
    const rows = monthRows([cell('2026-12-30', 400), cell('2026-12-31', 410), cell('2027-01-01', 390)]);
    expect(rows.map((r) => r.key)).toEqual(['2026-12', '2027-01']);
    expect(rows[0].days[29]?.depart_date).toBe('2026-12-30');
    expect(rows[0].days[0]).toBeUndefined();
    expect(rows[1].days[0]?.depart_date).toBe('2027-01-01');
    expect(rows[0].label).toContain('2026');
  });
});

describe('dates', () => {
  it('formats weekday and day.month in Hebrew without "יום"', () => {
    // 18 Feb 2027 is a Thursday.
    expect(weekdayDayMonth('2027-02-18')).toBe('חמישי 18.2');
  });
});

describe('cheapest picks and saving', () => {
  const cells = [cell('2027-01-01', 500), cell('2027-01-02', 405), cell('2027-01-03', null), cell('2027-01-04', 405)];

  it('picks the cheapest day, earliest on ties, ignoring unpriced days', () => {
    expect(cheapestCell(scan(cells))?.depart_date).toBe('2027-01-02');
    expect(cheapestDays(scan(cells), 2).map((c) => c.depart_date)).toEqual(['2027-01-02', '2027-01-04']);
  });

  it('shows a saving only with enough days and a real difference', () => {
    const many = Array.from({ length: 12 }, (_, i) => cell(`2027-02-${String(i + 1).padStart(2, '0')}`, 400 + i * 10));
    const s = scan(many, { min: { amount: '400.00', currency: 'ILS' }, mean: { amount: '455.00', currency: 'ILS' } });
    expect(savingVsAverage(s)).toBe(55);
    const few = scan(cells, { min: { amount: '405.00', currency: 'ILS' }, mean: { amount: '438.33', currency: 'ILS' } });
    expect(savingVsAverage(few)).toBeNull();
    const flat = scan(many, { min: { amount: '400.00', currency: 'ILS' }, mean: { amount: '400.40', currency: 'ILS' } });
    expect(savingVsAverage(flat)).toBeNull();
  });
});

describe('googleFlightsUrl', () => {
  it('builds an https Google Flights search for the same route and dates', () => {
    const url = new URL(googleFlightsUrl({ origin: 'TLV', destination: 'ATH', depart: '2027-02-18', ret: '2027-02-22' }));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('www.google.com');
    expect(url.pathname).toBe('/travel/flights');
    expect(url.searchParams.get('q')).toBe('Flights from TLV to ATH on 2027-02-18 through 2027-02-22');
    expect(url.searchParams.get('curr')).toBe('ILS');
  });
  it('supports one-way', () => {
    const url = new URL(googleFlightsUrl({ origin: 'TLV', destination: 'ATH', depart: '2027-02-18' }));
    expect(url.searchParams.get('q')).toContain('One way');
  });
});

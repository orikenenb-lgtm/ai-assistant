import { describe, expect, it } from 'vitest';
import { stripBidi } from '@/lib/format';
import { FareCalendarResponseSchema } from '@/lib/schemas/calendar';
import {
  calendarBaseFromParams,
  cellAriaLabel,
  cellPriceText,
  inRange,
  matrixNights,
  matrixRequest,
  matrixStartFor,
  monthRequest,
  monthWeeks,
  moveLinear,
  moveMatrix,
  searchBodyForCell,
  withoutRepeatedSentences,
} from './model';
import { calendarResponse, calendarSearchParams } from './testFixtures';

const today = '2026-11-12';
const base = calendarBaseFromParams(calendarSearchParams)!;

describe('calendar base + requests', () => {
  it('derives route, party and nights from the search params', () => {
    expect(base).toMatchObject({ origin: 'TLV', destination: 'FCO', adults: 2, childrenAges: [7], nights: 5, departDate: '2026-12-10' });
    expect(calendarBaseFromParams({ ...calendarSearchParams, return_date: null })?.nights).toBeNull();
    expect(calendarBaseFromParams({ origin: 'TL' })).toBeNull();
  });

  it('month request covers the month with the search nights, clamped to today', () => {
    expect(monthRequest(base, '2026-12', today)).toMatchObject({ depart_from: '2026-12-01', depart_to: '2026-12-31', trip_nights: [5], adults: 2, children_ages: [7] });
    expect(monthRequest(base, '2026-11', today)).toMatchObject({ depart_from: '2026-11-12', depart_to: '2026-11-30' });
    expect(monthRequest(base, '2026-10', today)).toBeNull();
    // Return must stay within a year: the last depart date leaves room for the nights.
    expect(monthRequest(base, '2027-11', today)?.depart_to).toBe('2027-11-07');
    expect(monthRequest({ ...base, nights: null }, '2026-12', today)?.trip_nights).toEqual([]);
  });

  it('matrix is 7 depart dates × 7 nights inside 1..30 (49 cells ≤ 150)', () => {
    expect(matrixNights(5)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(matrixNights(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(matrixNights(30)).toEqual([24, 25, 26, 27, 28, 29, 30]);
    expect(matrixStartFor('2026-12-10', today)).toBe('2026-12-07');
    expect(matrixStartFor('2026-11-13', today)).toBe(today);
    const req = matrixRequest(base, '2026-12-07', matrixNights(5), today)!;
    expect(req).toMatchObject({ depart_from: '2026-12-07', depart_to: '2026-12-13', trip_nights: [2, 3, 4, 5, 6, 7, 8] });
    expect(matrixRequest({ ...base, nights: null }, '2026-12-07', [5], today)).toBeNull();
  });

  it('knows which dates are searchable', () => {
    expect(inRange('2026-11-11', today)).toBe(false);
    expect(inRange('2026-11-12', today)).toBe(true);
    expect(inRange('2027-11-10', today, 5)).toBe(false);
  });

  it('builds the normal flight search body for a cell (exact dates, no flexibility)', () => {
    const body = searchBodyForCell({ ...calendarSearchParams, flex_days: 2 }, { depart_date: '2026-12-03', return_date: '2026-12-08', nights: 5 });
    expect(body).toMatchObject({ origin: 'TLV', destination: 'FCO', depart_date: '2026-12-03', return_date: '2026-12-08', flex_days: 0, adults: 2, children_ages: [7], cabin: 'economy' });
    expect(searchBodyForCell(calendarSearchParams, { depart_date: '2026-12-03', return_date: null, nights: 7 }).return_date).toBe('2026-12-10');
  });
});

describe('grid layout + keyboard', () => {
  it('lays out a month Sunday-first with padding', () => {
    const weeks = monthWeeks('2026-12'); // 1 Dec 2026 is a Tuesday
    expect(weeks[0]).toEqual([null, null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
  });

  it('moves by day/week with RTL-aware arrows, clamped to the month', () => {
    const opts = { length: 31, rtl: true, firstWeekday: 2 };
    expect(moveLinear(9, 'ArrowLeft', opts)).toBe(10); // RTL: left = next day
    expect(moveLinear(9, 'ArrowRight', opts)).toBe(8);
    expect(moveLinear(9, 'ArrowDown', opts)).toBe(16);
    expect(moveLinear(2, 'ArrowUp', opts)).toBe(0);
    expect(moveLinear(9, 'ArrowLeft', { ...opts, rtl: false })).toBe(8);
    // index 9 = 10 Dec (Thursday): Home → Sunday 6 Dec (index 5), End → Saturday 12 Dec (index 11)
    expect(moveLinear(9, 'Home', opts)).toBe(5);
    expect(moveLinear(9, 'End', opts)).toBe(11);
    expect(moveLinear(30, 'ArrowLeft', opts)).toBe(30);
    expect(moveLinear(9, 'Enter', opts)).toBeNull();
  });

  it('moves in the depart × nights matrix', () => {
    const o = { rows: 7, cols: 7, rtl: true };
    expect(moveMatrix({ row: 3, col: 3 }, 'ArrowLeft', o)).toEqual({ row: 3, col: 4 });
    expect(moveMatrix({ row: 3, col: 3 }, 'ArrowUp', o)).toEqual({ row: 2, col: 3 });
    expect(moveMatrix({ row: 6, col: 0 }, 'ArrowDown', o)).toEqual({ row: 6, col: 0 });
    expect(moveMatrix({ row: 3, col: 3 }, 'End', o)).toEqual({ row: 3, col: 6 });
  });
});

describe('labels', () => {
  const data = FareCalendarResponseSchema.parse(calendarResponse(monthRequest(base, '2026-12', today)!));
  const byDay = (d: number) => data.cells.find((c) => c.depart_date === `2026-12-${String(d).padStart(2, '0')}`);

  it('the response fixture matches the contract schema', () => {
    expect(data.cells).toHaveLength(31);
  });

  it('aria-label carries dates, exact total, per person, tier and mode (colour is never the only signal)', () => {
    const label = stripBidi(cellAriaLabel({ depart: '2026-12-03', nights: 5, cell: byDay(3), selected: true }));
    expect(label).toContain('יציאה יום חמישי, 3 בדצמבר');
    expect(label).toContain('חזרה יום שלישי, 8 בדצמבר (5 לילות)');
    expect(label).toContain('החל מ-2,100.00 ₪ ל-3 נוסעים');
    expect(label).toContain('700.00 ₪ לנוסע');
    expect(label).toContain('המחיר הנמוך ביותר בלוח');
    expect(label).toContain('נתוני הדגמה');
    expect(label).toContain('התאריכים של החיפוש הנוכחי');
    expect(cellAriaLabel({ depart: '2026-12-06', nights: 5, cell: byDay(6) })).toContain('אין טיסות');
    expect(cellAriaLabel({ depart: '2026-12-07', nights: 5, cell: byDay(7) })).toContain('לא נבדק');
    expect(cellAriaLabel({ depart: '2026-12-08', nights: 5, cell: byDay(8) })).toContain('שגיאה בבדיקה · הספק לא ענה');
  });

  it('cell prices are rounded to whole units for scanning, never parsed as floats', () => {
    expect(stripBidi(cellPriceText({ amount: '2421.73', currency: 'ILS' }) ?? '')).toBe('2,422 ₪');
    expect(cellPriceText(null)).toBeNull();
  });

  it('does not repeat honesty sentences already on the page', () => {
    const note = 'המחירים בלוח מבוססים על ספקי הדגמה. אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים נוספים.';
    expect(withoutRepeatedSentences(note, 'אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים נוספים.')).toBe('המחירים בלוח מבוססים על ספקי הדגמה.');
    expect(withoutRepeatedSentences(note, null)).toBe(note);
  });
});

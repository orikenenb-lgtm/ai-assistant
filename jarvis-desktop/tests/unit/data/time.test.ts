import { describe, expect, it } from 'vitest';
import {
  ZONE,
  addDaysLocal,
  describeWhenHe,
  formatHebrewDate,
  formatHebrewFull,
  formatLocalTime,
  isFuture,
  localDayRangeUtc,
  localMonthRangeUtc,
  monthLocal,
  parseLocalDate,
  resolveLocalDateTime,
  todayLocal,
} from '../../../src/main/time/time';

/** ההיסט של ישראל ברגע נתון לפי Intl בלבד (בלי luxon) — מקור אמת עצמאי לבדיקה. */
function intlOffset(ms: number): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

/** סורק את 2026 ומוצא את רגעי המעבר האמיתיים לפי נתוני ה-ICU של הסביבה. */
function transitions2026(): Array<{ atUtc: string; from: string; to: string }> {
  const out: Array<{ atUtc: string; from: string; to: string }> = [];
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 0, 1);
  let prev = intlOffset(start);
  for (let t = start + 15 * 60_000; t <= end; t += 15 * 60_000) {
    const cur = intlOffset(t);
    if (cur !== prev) {
      out.push({ atUtc: new Date(t).toISOString(), from: prev, to: cur });
      prev = cur;
    }
  }
  return out;
}

describe('Israel DST transitions in 2026 (real ICU data)', () => {
  const found = transitions2026();

  it('finds exactly two transitions: Fri 27 Mar 02:00 -> 03:00 and Sun 25 Oct 02:00 -> 01:00', () => {
    expect(found).toEqual([
      { atUtc: '2026-03-27T00:00:00.000Z', from: 'GMT+02:00', to: 'GMT+03:00' },
      { atUtc: '2026-10-24T23:00:00.000Z', from: 'GMT+03:00', to: 'GMT+02:00' },
    ]);
  });

  it('the gap and overlap derived from the found instants are detected', () => {
    // הקפיצה: זמן קיר מקומי ברגע המעבר לפי ההיסט הישן = השעה שלא קיימת
    const spring = found[0];
    const autumn = found[1];
    expect(spring && autumn).toBeTruthy();
    const springWall = new Date(Date.parse(spring!.atUtc) + 2 * 3600_000).toISOString(); // +02:00
    const gapDate = springWall.slice(0, 10);
    const gapTime = springWall.slice(11, 16);
    expect(resolveLocalDateTime(gapDate, gapTime)).toMatchObject({ ok: false, code: 'DST_GAP' });
    const autumnWall = new Date(Date.parse(autumn!.atUtc) + 2 * 3600_000).toISOString(); // השעה שחוזרת
    expect(resolveLocalDateTime(autumnWall.slice(0, 10), autumnWall.slice(11, 16))).toMatchObject({
      ok: false,
      code: 'DST_AMBIGUOUS',
    });
  });
});

describe('resolveLocalDateTime', () => {
  it('normal winter time (+02:00)', () => {
    expect(resolveLocalDateTime('2026-01-15', '08:00')).toEqual({
      ok: true,
      utcIso: '2026-01-15T06:00:00.000Z',
      display_he: 'יום חמישי, 15 בינואר 2026 בשעה 08:00',
      offset: '+02:00',
    });
  });

  it('normal summer time (+03:00)', () => {
    expect(resolveLocalDateTime('2026-07-01', '20:30')).toEqual({
      ok: true,
      utcIso: '2026-07-01T17:30:00.000Z',
      display_he: 'יום רביעי, 1 ביולי 2026 בשעה 20:30',
      offset: '+03:00',
    });
  });

  it('the example from the spec: 6 Oct 2026 08:00', () => {
    const r = resolveLocalDateTime('2026-10-06', '08:00');
    expect(r).toEqual({
      ok: true,
      utcIso: '2026-10-06T05:00:00.000Z',
      display_he: 'יום שלישי, 6 באוקטובר 2026 בשעה 08:00',
      offset: '+03:00',
    });
  });

  it('DST gap: 2026-03-27 02:30 does not exist; suggests 03:30', () => {
    const r = resolveLocalDateTime('2026-03-27', '02:30');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DST_GAP');
    expect(r.message_he).toContain('02:30');
    expect(r.message_he).toContain('לא קיימת');
    expect(r.options?.[0]?.id).toBe('03:30');
  });

  it('DST gap boundaries: 02:00 is in the gap, 01:59 and 03:00 exist', () => {
    expect(resolveLocalDateTime('2026-03-27', '02:00')).toMatchObject({ ok: false, code: 'DST_GAP' });
    expect(resolveLocalDateTime('2026-03-27', '01:59')).toMatchObject({ ok: true, utcIso: '2026-03-26T23:59:00.000Z' });
    expect(resolveLocalDateTime('2026-03-27', '03:00')).toMatchObject({ ok: true, utcIso: '2026-03-27T00:00:00.000Z' });
  });

  it('DST overlap: 2026-10-25 01:30 happens twice; both instants found and selectable', () => {
    const r = resolveLocalDateTime('2026-10-25', '01:30');
    expect(r).toMatchObject({ ok: false, code: 'DST_AMBIGUOUS' });
    if (r.ok) return;
    expect(r.options?.map((o) => o.id)).toEqual(['earlier', 'later']);
    expect(r.message_he).toContain('פעמיים');

    const earlier = resolveLocalDateTime('2026-10-25', '01:30', { dstChoice: 'earlier' });
    const later = resolveLocalDateTime('2026-10-25', '01:30', { dstChoice: 'later' });
    expect(earlier).toMatchObject({ ok: true, utcIso: '2026-10-24T22:30:00.000Z', offset: '+03:00' });
    expect(later).toMatchObject({ ok: true, utcIso: '2026-10-24T23:30:00.000Z', offset: '+02:00' });
    if (earlier.ok && later.ok) {
      // אותה שעת קיר — ההפרש בין הרגעים הוא בדיוק שעה
      expect(Date.parse(later.utcIso) - Date.parse(earlier.utcIso)).toBe(3600_000);
      expect(earlier.display_he).toContain('שעון קיץ');
      expect(later.display_he).toContain('שעון חורף');
    }
  });

  it('DST overlap boundaries: 01:00 is ambiguous, 00:59 and 02:00 are not', () => {
    expect(resolveLocalDateTime('2026-10-25', '01:00')).toMatchObject({ ok: false, code: 'DST_AMBIGUOUS' });
    expect(resolveLocalDateTime('2026-10-25', '00:59')).toMatchObject({ ok: true, utcIso: '2026-10-24T21:59:00.000Z' });
    expect(resolveLocalDateTime('2026-10-25', '02:00')).toMatchObject({ ok: true, utcIso: '2026-10-25T00:00:00.000Z' });
  });

  it('rejects invalid dates and times with Hebrew messages', () => {
    for (const [date, time] of [
      ['2026-02-30', '08:00'],
      ['2026-13-01', '08:00'],
      ['26-10-06', '08:00'],
      ['2026-10-06', '24:00'],
      ['2026-10-06', '08:60'],
      ['2026-10-06', '8am'],
      ['1999-12-31', '08:00'],
    ] as const) {
      const r = resolveLocalDateTime(date, time);
      expect(r, `${date} ${time}`).toMatchObject({ ok: false, code: 'INVALID_PARAMS' });
      if (!r.ok) expect(r.message_he).toMatch(/[א-ת]/);
    }
  });

  it('accepts a single-digit hour (8:05)', () => {
    expect(resolveLocalDateTime('2026-10-06', '8:05')).toMatchObject({ ok: true, utcIso: '2026-10-06T05:05:00.000Z' });
  });
});

describe('formatting and local dates', () => {
  it('formatHebrewFull produces the exact string', () => {
    expect(formatHebrewFull('2026-10-06T05:00:00.000Z')).toBe('יום שלישי, 6 באוקטובר 2026 בשעה 08:00');
    // אחרי חצות בישראל זה כבר היום הבא; שעה דו-ספרתית
    expect(formatHebrewFull('2026-01-01T22:05:00Z')).toBe('יום שישי, 2 בינואר 2026 בשעה 00:05');
    expect(formatHebrewFull('2026-12-31T21:59:00Z')).toBe('יום חמישי, 31 בדצמבר 2026 בשעה 23:59');
  });

  it('formatHebrewFull throws on invalid input', () => {
    expect(() => formatHebrewFull('not a date')).toThrow(RangeError);
  });

  it('formatLocalTime / formatHebrewDate', () => {
    expect(formatLocalTime('2026-10-06T05:00:00.000Z')).toBe('08:00');
    expect(formatLocalTime('2026-10-05T21:00:00.000Z')).toBe('00:00');
    expect(formatHebrewDate('2026-10-06')).toBe('יום שלישי, 6 באוקטובר 2026');
  });

  it('todayLocal uses the Israel date, not UTC', () => {
    expect(todayLocal(new Date('2026-10-05T20:59:00Z'))).toBe('2026-10-05');
    expect(todayLocal(new Date('2026-10-05T21:30:00Z'))).toBe('2026-10-06');
    expect(todayLocal(new Date('2026-01-31T22:30:00Z'))).toBe('2026-02-01');
    expect(monthLocal(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10');
  });

  it('isFuture', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(isFuture('2026-10-05T10:00:01Z', now)).toBe(true);
    expect(isFuture('2026-10-05T10:00:00Z', now)).toBe(false);
    expect(isFuture('2026-10-05T09:59:59Z', now)).toBe(false);
    expect(isFuture('garbage', now)).toBe(false);
  });

  it('addDaysLocal / parseLocalDate', () => {
    expect(addDaysLocal('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDaysLocal('2026-12-31', 1)).toBe('2027-01-01');
    expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseLocalDate('2026-02-29')).toBeNull();
  });

  it('local day range on the autumn DST day is 25 hours', () => {
    const r = localDayRangeUtc(new Date('2026-10-25T10:00:00Z'));
    expect(r).toEqual({ startIso: '2026-10-24T21:00:00.000Z', endIso: '2026-10-25T22:00:00.000Z' });
    const m = localMonthRangeUtc(new Date('2026-10-05T10:00:00Z'));
    expect(m).toEqual({ startIso: '2026-09-30T21:00:00.000Z', endIso: '2026-10-31T22:00:00.000Z' });
  });

  it('describeWhenHe uses today/tomorrow wording', () => {
    const now = new Date('2026-10-05T10:00:00Z'); // 13:00 בישראל
    expect(describeWhenHe('2026-10-05T15:00:00Z', now)).toBe('היום בשעה 18:00');
    expect(describeWhenHe('2026-10-06T05:00:00Z', now)).toBe('מחר בשעה 08:00');
    expect(describeWhenHe('2026-10-08T05:00:00Z', now)).toBe('יום חמישי, 8 באוקטובר 2026 בשעה 08:00');
  });
});

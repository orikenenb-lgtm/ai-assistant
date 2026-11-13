import { formatDate, formatDateRange, formatOffset, formatRelative, parseIso, stripBidi } from './format';

describe('date formatting', () => {
  it('keeps the source wall-clock time from the ISO offset', () => {
    // 08:15 in Athens (+02:00) must stay 08:15 regardless of the viewer's zone.
    expect(formatDate('2026-12-01T08:15:00+02:00', 'time', 'source')).toBe('08:15');
    expect(formatDate('2026-12-01T23:30:00-05:00', 'time', 'source')).toBe('23:30');
  });

  it('converts to an explicit IANA zone', () => {
    expect(formatDate('2026-12-01T06:15:00Z', 'time', 'Asia/Jerusalem')).toBe('08:15');
  });

  it('never shifts date-only values', () => {
    expect(formatDate('2026-12-01', 'date', 'viewer')).toBe('1 בדצמ׳ 2026');
  });

  it('formats ranges compactly', () => {
    expect(stripBidi(formatDateRange('2026-12-01', '2026-12-08')!)).toBe('1–8 בדצמ׳ 2026');
  });

  it('labels the UTC offset', () => {
    expect(formatOffset('2026-12-01T08:15:00+02:00')).toBe('UTC+02:00');
    expect(formatOffset('2026-12-01T08:15:00Z')).toBe('UTC+00:00');
    expect(formatOffset('2026-12-01')).toBeNull();
  });

  it('parses offsets into instants', () => {
    expect(parseIso('2026-12-01T08:15:00+02:00')!.instant.toISOString()).toBe('2026-12-01T06:15:00.000Z');
    expect(parseIso('garbage')).toBeNull();
  });

  it('formats relative freshness in Hebrew', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(formatRelative('2026-11-12T11:55:00Z', now)).toBe('לפני 5 דק׳');
    expect(formatRelative('2026-11-12T11:59:50Z', now)).toBe('עכשיו');
    expect(formatRelative('2026-11-11T12:00:00Z', now)).toBe('אתמול');
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatClock,
  formatCountdown,
  formatDueDate,
  formatFraction,
  formatHebrewDate,
  formatNumber,
  formatPercent,
  formatShortTime,
  formatUptime,
} from '../../../src/renderer/state/format';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024 * 1024, '10 MB'],
    [1024 ** 3, '1 GB'],
    [16 * 1024 ** 3, '16 GB'],
    [476.9 * 1024 ** 3, '477 GB'],
    [2 * 1024 ** 4, '2 TB'],
  ])('%d -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('rejects invalid values', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatPercent / formatFraction', () => {
  it('rounds and clamps', () => {
    expect(formatPercent(41.6)).toBe('42%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(100.4)).toBe('100%');
    expect(formatPercent(-3)).toBe('0%');
  });
  it('null / NaN -> dash (no fake number)', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
  it('fraction 0..1', () => {
    expect(formatFraction(0.42)).toBe('42%');
    expect(formatFraction(1)).toBe('100%');
  });
});

describe('Hebrew date and time in Asia/Jerusalem', () => {
  it('uses Israel time, not UTC (date rolls over at local midnight)', () => {
    // 21:30 UTC = 00:30 בישראל (שעון קיץ, UTC+3) — כבר יום שלישי
    const d = new Date('2026-10-05T21:30:00Z');
    expect(formatHebrewDate(d)).toBe('יום שלישי, 6 באוקטובר 2026');
    expect(formatClock(d)).toBe('00:30:00');
  });

  it('handles winter time (UTC+2)', () => {
    const d = new Date('2026-12-01T08:05:09Z');
    expect(formatClock(d)).toBe('10:05:09');
    expect(formatHebrewDate(d)).toBe('יום שלישי, 1 בדצמבר 2026');
  });

  it('short time from ISO strings', () => {
    expect(formatShortTime('2026-10-05T05:00:00Z')).toBe('08:00');
    expect(formatShortTime('not a date')).toBe('');
  });

  it('due date YYYY-MM-DD keeps the same calendar day', () => {
    expect(formatDueDate('2026-10-06')).toMatch(/^6 /);
    expect(formatDueDate('bad')).toBe('bad');
  });
});

describe('formatCountdown / formatUptime / formatNumber', () => {
  it('countdown', () => {
    expect(formatCountdown(42_100)).toBe('43 שניות');
    expect(formatCountdown(1000)).toBe('שנייה אחת');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(-5)).toBe('0 שניות');
  });
  it('uptime', () => {
    expect(formatUptime(59)).toBe('0 דקות');
    expect(formatUptime(60)).toBe('דקה אחת');
    expect(formatUptime(3 * 3600 + 12 * 60)).toBe('3 שעות, 12 דקות');
    expect(formatUptime(86_400 + 3600)).toBe('יום אחד, שעה אחת');
    expect(formatUptime(3 * 86_400 + 4 * 3600)).toBe('3 ימים, 4 שעות');
  });
  it('number grouping', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

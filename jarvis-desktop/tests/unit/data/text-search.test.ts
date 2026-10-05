import { describe, expect, it } from 'vitest';
import { MIN_SEARCH_SCORE, STRONG_MATCH_SCORE, pickSingle, rankByText, scoreText } from '../../../src/main/db/text-search';
import { clip, joinHebrew, joinHebrewCapped, stripTrailingPunctuation } from '../../../src/main/time/hebrew-text';

describe('scoreText / rankByText / pickSingle', () => {
  it('exact after normalization scores 1', () => {
    expect(scoreText('לסיים את השרטוט', 'לסיים את השרטוט')).toBe(1);
    expect(scoreText('לְסַיֵּם את השרטוט', 'לסיים את השרטוט')).toBe(1);
    expect(scoreText('EPLAN', 'eplan')).toBe(1);
  });

  it('word coverage with Hebrew prefixes is a strong match', () => {
    expect(scoreText('הדוח החודשי', 'לשלוח דוח חודשי')).toBeGreaterThanOrEqual(STRONG_MATCH_SCORE);
    expect(scoreText('חלב', 'לקנות חלב')).toBeGreaterThanOrEqual(STRONG_MATCH_SCORE);
  });

  it('partial word overlap is weak; unrelated is zero', () => {
    const partial = scoreText('לשלוח מייל', 'לשלוח דוח');
    expect(partial).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(partial).toBeLessThan(STRONG_MATCH_SCORE);
    expect(scoreText('להתקשר לאמא', 'להתקשר לאבא')).toBeLessThan(STRONG_MATCH_SCORE);
    expect(scoreText('פיצה', 'לשלוח דוח')).toBe(0);
    expect(scoreText('', 'x')).toBe(0);
  });

  it('pickSingle: exact unique wins, several strong -> many, only weak -> weak, none -> none', () => {
    const items = ['לשלוח דוח לדני', 'לשלוח דוח לרונית', 'לקנות חלב'];
    const text = (s: string) => s;
    expect(pickSingle(rankByText('לקנות חלב', items, text))).toEqual({ kind: 'one', item: 'לקנות חלב' });
    expect(pickSingle(rankByText('דוח', items, text))).toEqual({ kind: 'many', items: ['לשלוח דוח לדני', 'לשלוח דוח לרונית'] });
    expect(pickSingle(rankByText('לשלוח מייל', ['לשלוח דוח'], text))).toEqual({ kind: 'weak', items: ['לשלוח דוח'] });
    expect(pickSingle(rankByText('פיצה', items, text))).toEqual({ kind: 'none' });
    // שתי משימות זהות — לא בוחרים לבד
    expect(pickSingle(rankByText('לקנות חלב', ['לקנות חלב', 'לקנות חלב'], text)).kind).toBe('many');
  });
});

describe('Hebrew phrasing helpers', () => {
  it('joins lists with a natural ו', () => {
    expect(joinHebrew([])).toBe('');
    expect(joinHebrew(['א'])).toBe('א');
    expect(joinHebrew(['לקנות חלב', 'לשלוח דוח'])).toBe('לקנות חלב ולשלוח דוח');
    expect(joinHebrew(['א', 'ב', 'EPLAN'])).toBe('א, ב ו-EPLAN');
    expect(joinHebrewCapped(['1', '2', '3', '4'], 2)).toBe('1, 2 ועוד 2');
  });

  it('clips and strips punctuation', () => {
    expect(clip('  שלום   עולם  ', 50)).toBe('שלום עולם');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
    expect(stripTrailingPunctuation('לפתוח את הפרויקט.')).toBe('לפתוח את הפרויקט');
  });
});

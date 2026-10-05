import { describe, expect, it } from 'vitest';
import { FUZZY_CAP, MIN_SEARCH_SCORE, STRONG_MATCH_SCORE, pickSingle, rankByText, scoreText } from '../../../src/main/db/text-search';
import { clip, joinHebrew, joinHebrewCapped, stripTrailingPunctuation } from '../../../src/main/time/hebrew-text';

describe('scoreText / rankByText / pickSingle', () => {
  it('exact after normalization scores 1', () => {
    expect(scoreText('לסיים את השרטוט', 'לסיים את השרטוט')).toBe(1);
    expect(scoreText('שָׁלוֹם לְכֻלָּם', 'שלום לכלם')).toBe(1);
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
    // הבדל של אות אחת שמשנה משמעות — לעולם לא התאמה חזקה
    expect(scoreText('להתקשר לאמא', 'להתקשר לאבא')).toBeLessThan(STRONG_MATCH_SCORE);
    expect(scoreText('להתקשר לאמא', 'להתקשר לאבא')).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    // שגיאת תמלול במילה ארוכה עדיין נמצאת — אבל רק כהצעה ("התכוונת ל...?"), לא לביצוע אוטומטי
    expect(scoreText('לסיים את השירטוט', 'לסיים את השרטוט')).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(scoreText('לסיים את השירטוט', 'לסיים את השרטוט')).toBeLessThan(STRONG_MATCH_SCORE);
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

describe('wrong-target regressions: one-letter siblings never auto-select', () => {
  const text = (s: string) => s;
  // זוגות שבהם אות אחת משנה את האדם/הפריט — נמצאים כהצעה בלבד
  const siblings: Array<[string, string]> = [
    ['לשלוח לאורי', 'לשלוח לאורית'],
    ['להתקשר לדניאל', 'להתקשר לדניאלה'],
    ['לקנות מתנה לנועה', 'לקנות מתנה לנועם'],
    ['פגישה עם יוסי', 'פגישה עם יוסף'],
    ['להתקשר לאמא', 'להתקשר לאבא'],
  ];

  it.each(siblings)('"%s" vs "%s" is capped at FUZZY_CAP and only suggested', (query, candidate) => {
    const score = scoreText(query, candidate);
    expect(score).toBeLessThanOrEqual(FUZZY_CAP);
    expect(score).toBeGreaterThanOrEqual(MIN_SEARCH_SCORE);
    expect(pickSingle(rankByText(query, [candidate], text))).toEqual({ kind: 'weak', items: [candidate] });
    // וגם בכיוון ההפוך
    expect(scoreText(candidate, query)).toBeLessThanOrEqual(FUZZY_CAP);
  });

  it('whole-word containment and clitic-stripped words are still strong', () => {
    expect(pickSingle(rankByText('לשלוח לאורי', ['לשלוח לאורי מחר בבוקר'], text)).kind).toBe('one');
    expect(pickSingle(rankByText('הדוח', ['לשלוח דוח חודשי'], text)).kind).toBe('one');
    expect(pickSingle(rankByText('מים', ['לשלם חשבון מים'], text)).kind).toBe('one');
  });

  it('with both siblings present the exact one is picked', () => {
    const items = ['לקנות מתנה לנועם', 'לקנות מתנה לנועה'];
    expect(pickSingle(rankByText('לקנות מתנה לנועה', items, text))).toEqual({ kind: 'one', item: 'לקנות מתנה לנועה' });
    expect(pickSingle(rankByText('לשלוח לאורי', ['לשלוח לאורית', 'לשלוח לאורי'], text))).toEqual({
      kind: 'one',
      item: 'לשלוח לאורי',
    });
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

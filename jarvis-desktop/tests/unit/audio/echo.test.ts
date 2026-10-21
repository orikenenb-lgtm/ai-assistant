import { describe, expect, it } from 'vitest';
import { isLikelyEcho } from '../../../src/renderer/audio/echo';
import { isLikelyEcho as exported } from '../../../src/renderer/audio/index';

const SPOKEN = 'פתחתי את ספוטיפיי. יש עוד משהו שאני יכול לעשות בשבילך?';

describe('isLikelyEcho', () => {
  it('is the implementation exported from the audio entry point', () => {
    expect(exported).toBe(isLikelyEcho);
  });

  it('detects an echoed fragment despite niqqud, punctuation and final-letter differences', () => {
    expect(isLikelyEcho('יֵשׁ עוֹד מַשֶּׁהוּ, שֶׁאֲנִי יָכוֹל', SPOKEN, 500)).toBe(true);
    expect(isLikelyEcho('"פתחתי את ספוטיפיי!"', SPOKEN, 2_000)).toBe(true);
    // אות סופית שונה בתמלול (ך/כ) — הנרמול מאחד
    expect(isLikelyEcho('יכול לעשות בשבילכ', 'אני יכול לעשות בשבילך', 1_000)).toBe(true);
  });

  it('detects a near-complete echo with STT word changes via Jaccard ≥ 0.6', () => {
    // מילה אחת ("של") נבלעה בתמלול — לא רצף צמוד, אבל 5 מתוך 6 מילים משותפות
    expect(isLikelyEcho('הזכרתי לך את הפגישה מחר', 'הזכרתי לך את הפגישה של מחר', 1_000)).toBe(true);
    expect(isLikelyEcho('המשימה נוספה לרשימה שלך', 'המשימה נוספה לרשימה', 3_000)).toBe(true);
  });

  it('returns false for unrelated speech', () => {
    expect(isLikelyEcho('תזכיר לי מחר בשמונה להתקשר לאמא', SPOKEN, 1_000)).toBe(false);
    expect(isLikelyEcho('open eplan', SPOKEN, 1_000)).toBe(false);
  });

  it('returns false outside the 8 second window', () => {
    expect(isLikelyEcho('יש עוד משהו שאני יכול', SPOKEN, 8_001)).toBe(false);
    expect(isLikelyEcho('יש עוד משהו שאני יכול', SPOKEN, 60_000)).toBe(false);
    expect(isLikelyEcho('יש עוד משהו שאני יכול', SPOKEN, 8_000)).toBe(true);
    expect(isLikelyEcho('יש עוד משהו שאני יכול', SPOKEN, Number.NaN)).toBe(false);
  });

  it('treats a negative interval (still speaking) as inside the window', () => {
    expect(isLikelyEcho('יש עוד משהו שאני יכול', SPOKEN, -200)).toBe(true);
  });

  it('is never true for an empty or missing last spoken text, or an empty transcript', () => {
    expect(isLikelyEcho('יש עוד משהו', '', 100)).toBe(false);
    expect(isLikelyEcho('יש עוד משהו', null, 100)).toBe(false);
    expect(isLikelyEcho('יש עוד משהו', '?!...', 100)).toBe(false);
    expect(isLikelyEcho('', SPOKEN, 100)).toBe(false);
    expect(isLikelyEcho(' ,. ', SPOKEN, 100)).toBe(false);
  });

  it('never swallows legit short answers that also appear in the question', () => {
    const question = 'מצאתי שני פרויקטים: פרויקט הגמר ופרויקט המעבדה. לאיזה התכוונת?';
    expect(isLikelyEcho('פרויקט הגמר', question, 1_200)).toBe(false);
    expect(isLikelyEcho('כן', 'לבטל את התזכורת? כן או לא', 800)).toBe(false);
    expect(isLikelyEcho('לא', 'לא הבנתי. תוכל לחזור על זה?', 800)).toBe(false);
    expect(isLikelyEcho('ספוטיפיי', SPOKEN, 500)).toBe(false);
    expect(isLikelyEcho('כן כן', 'כן?', 500)).toBe(false);
  });

  it('matches whole words only, not characters inside words', () => {
    // "כן" נמצא בתוך "כנראה" ברמת התווים (אחרי נרמול אותיות סופיות) — אבל זו לא אותה מילה
    expect(isLikelyEcho('כן', 'כנראה שכן', 500)).toBe(false);
    expect(isLikelyEcho('את ספוטיפיי עכשיו', 'פתחתי את ספוטיפיי', 500)).toBe(false);
  });
});

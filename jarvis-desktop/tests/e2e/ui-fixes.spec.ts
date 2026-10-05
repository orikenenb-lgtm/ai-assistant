import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerNativeDialogs, launchJarvis } from './helpers';

/**
 * תיקוני ממשק מהסקירה: הודעות לא מכסות כפתורים/שדות (קומפקטי והגדרות), כפתור הגדרות בתצוגה הקומפקטית,
 * בדיקת נתיב אוטומטית אחרי עריכה, ושדות ההגדרות החדשים.
 * ⚠ MOCK: אין שירותי ענן — ההודעה הארוכה נוצרת מכשל הקראה (Azure בלי מפתח), כך שהיא דטרמיניסטית גם ב-Windows.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element not visible');
  return b;
}

/** תשובה מקומית שמוקראת ב-Azure בלי מפתח → הודעה ארוכה ("ההקראה בענן נכשלה …", ואחריה אולי "לא נמצא קול מערכת …"). */
async function produceLongToast(page: Page): Promise<void> {
  const res = await page.evaluate(async () => {
    const s = await window.jarvis.settings.get();
    return window.jarvis.settings.update({ tts: { ...s.tts, provider: 'azure', autoSpeak: true } });
  });
  expect(res.ok).toBe(true);
  await page.evaluate(() => window.jarvis.assistant.submit({ text: 'מצב מערכת', source: 'text', clientRequestId: crypto.randomUUID() }));
}

test('(mock) compact view: a long toast is a one-line strip that never covers the buttons; the gear opens settings', async () => {
  const { app, page } = await launchJarvis();
  try {
    await page.locator('button[aria-label="מעבר לתצוגה קומפקטית"]').click();
    await expect(page.locator('.compact')).toBeVisible();
    await produceLongToast(page);
    const strip = page.locator('.compact-toast');
    await expect(strip).toBeVisible({ timeout: 20_000 });
    const title = (await strip.getAttribute('title')) ?? '';
    // אחרי כשל Azure JARVIS עובר לקול המערכת; במחשב בלי קול עברי (כמו מכונת CI של Windows) מגיעה מיד הודעה ארוכה שנייה.
    // מה שנבדק כאן הוא הפריסה של הודעה ארוכה, לא איזו מהשתיים מוצגת אחרונה.
    expect(title).toMatch(/ההקראה בענן נכשלה|לא נמצא קול מערכת להקראה/);
    expect(title.length).toBeGreaterThan(40);
    expect(await strip.locator('.compact-toast-text').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    const stripBox = await box(strip);
    for (const label of ['התחל האזנה (רווח)', 'עצור (Esc)', 'הגדרות (Ctrl+,)', 'הרחב לתצוגה מלאה']) {
      const button = page.locator(`.compact-actions button[aria-label="${label}"]`);
      expect(intersects(stripBox, await box(button)), label).toBe(false);
    }
    // כפתור ההגדרות: מרחיב זמנית ופותח את ההגדרות
    await page.locator('.compact-actions button[aria-label="הגדרות (Ctrl+,)"]').click();
    await expect(page.locator('.settings')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('(mock) settings: toasts sit in a strip below the content and never cover fields', async () => {
  const { app, page } = await launchJarvis();
  try {
    await page.keyboard.press('Control+Comma');
    await expect(page.locator('.settings')).toBeVisible();
    await produceLongToast(page);
    const strip = page.locator('.settings .toasts[data-variant="strip"]');
    await expect(strip).toBeVisible({ timeout: 20_000 });
    expect(intersects(await box(strip), await box(page.locator('.settings-panel')))).toBe(false);
    expect(intersects(await box(strip), await box(page.locator('.settings-nav')))).toBe(false);
    // אין ערימה צפה בזמן שההגדרות פתוחות
    await expect(page.locator('.app > .toasts')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('(mock) settings: new fields (start with Windows, missed-reminder grace) and automatic path check after editing', async () => {
  const { app, page } = await launchJarvis();
  try {
    await answerNativeDialogs(app, 0);
    await page.keyboard.press('Control+Comma');
    await expect(page.locator('.settings')).toBeVisible();
    await expect(page.getByText('הפעלה עם Windows')).toBeVisible();
    const grace = page.getByLabel('חלון חסד לתזכורת שהוחמצה (דקות)');
    await grace.fill('12');
    await grace.press('Enter');
    await expect.poll(async () => (await page.evaluate(() => window.jarvis.settings.get())).reminders.graceMinutes).toBe(12);
    await grace.fill('99');
    await grace.press('Enter');
    await expect(page.getByText('ערך לא תקין — מספר שלם בין 0 ל-60.')).toBeVisible();

    // תוכנות ופרויקטים: נתיב שלא קיים נשמר, אבל מיד מוצג ✗ (בלי ללחוץ "אמת")
    await page.locator('.settings-nav [role="tab"]', { hasText: 'תוכנות ופרויקטים' }).click();
    const firstApp = page.locator('.entry').first();
    const target = firstApp.getByLabel('נתיב / יעד');
    await target.fill('C:\\JARVIS-e2e\\does-not-exist\\EPLAN.exe');
    await target.press('Tab');
    await expect(firstApp.locator('.check-line .check-mark')).toHaveText('✗', { timeout: 10_000 });
  } finally {
    await app.close();
  }
});

test('a push-to-talk hotkey that Windows cannot register is not saved, and the previous hotkey stays', async () => {
  const { app, page } = await launchJarvis();
  try {
    const result = await page.evaluate(async () => {
      const s = await window.jarvis.settings.get();
      const bad = await window.jarvis.settings.update({ voice: { ...s.voice, pushToTalkHotkey: 'Ctrl+Alt+NotAKey' } });
      const after = await window.jarvis.settings.get();
      return { bad, hotkey: after.voice.pushToTalkHotkey };
    });
    expect(result.bad.ok).toBe(false);
    if (!result.bad.ok) expect(result.bad.message_he).toContain('קיצור המקשים');
    expect(result.hotkey).toBe('CommandOrControl+Alt+J');
    // הגדרות אחרות עדיין נשמרות כרגיל
    const other = await page.evaluate(async () => {
      const s = await window.jarvis.settings.get();
      return window.jarvis.settings.update({ ui: { ...s.ui, alwaysOnTop: true } });
    });
    expect(other.ok).toBe(true);
  } finally {
    await app.close();
  }
});

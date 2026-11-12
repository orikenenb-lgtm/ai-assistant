import { expect, type Page } from '@playwright/test';

/** Every line that mentions a real purchase/booking/charge must be a negation ("לא ..."), never a promise. */
export async function expectNoRealPurchaseWording(page: Page) {
  const text = await page.locator('body').innerText();
  for (const re of [/buy now/i, /pay now/i, /book now/i, /קנו עכשיו/, /שלמו עכשיו/, /הזמינו עכשיו/, /בצעו תשלום/, /מספר כרטיס אשראי/, /\bCVV\b/i]) {
    expect(text, `forbidden wording ${re} found`).not.toMatch(re);
  }
  for (const line of text.split('\n').filter((l) => /(רכישה|הזמנה|חיוב|תשלום) אמית/.test(l))) {
    expect(line, `"${line}" claims a real purchase/charge without negation`).toMatch(/לא|אינ|ללא|בלי|אין/);
  }
  await expect(page.locator('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvv" i]')).toHaveCount(0);
}

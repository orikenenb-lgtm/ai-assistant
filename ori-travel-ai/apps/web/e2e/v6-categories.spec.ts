import { expect } from '@playwright/test';
import { test } from './fixtures-v6';
import { futureDate } from './env';
import { offerCards } from './search-common';
import { rnd, searchIdOf } from './v6-helpers';

/** V6 non-flight categories: hotels (occupancy + cancellation), cars (driver age, deposit, fuel, insurance), attractions (participants + dates). */
test.describe('V6 מלונות, רכבים ואטרקציות', () => {
  test('V6-07 מלונות לפי תפוסה (שני חדרים, ילד אחד) עם תנאי ביטול גלויים', async ({ page, api }) => {
    const nights = 3;
    const checkIn = rnd(40, 200);
    await page.goto('/search/hotels');
    await page.getByRole('combobox', { name: 'יעד (עיר)' }).fill('ATH');
    await page.getByLabel('כניסה').fill(futureDate(checkIn));
    await page.getByLabel('יציאה').fill(futureDate(checkIn + nights));

    // Room 1: two adults + one 7-year-old; room 2: one adult.
    const room = (n: number) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: `חדר ${n}` }) });
    await expect(room(1)).toHaveCount(1);
    await room(1).getByRole('button', { name: 'הוספת ילד' }).click();
    await room(1).getByLabel('גיל ילד 1').selectOption('7');
    await page.getByRole('button', { name: 'הוספת חדר' }).click();
    await expect(room(2)).toHaveCount(1);
    await room(2).getByRole('button', { name: 'הפחתה: מבוגרים בחדר 2' }).click();
    await expect(room(2).getByLabel('מבוגרים בחדר 2: 1')).toBeVisible();

    // Only free-cancellation stays.
    await page.getByRole('button', { name: /אפשרויות נוספות/ }).click();
    await page.getByLabel('ביטול חינם בלבד').check();
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await expect(page).toHaveURL(/[?&]search_id=[0-9a-f]+/);

    // The search carries the exact occupancy.
    const searchId = searchIdOf(page.url());
    const fresh = await (await page.request.get(`/api/search/${searchId}`)).json();
    expect(fresh.params.rooms).toEqual([
      { adults: 2, children_ages: [7] },
      { adults: 1, children_ages: [] },
    ]);
    await expect(page.getByTestId('search-summary')).toContainText('3 מבוגרים + ילד אחד');

    const cards = offerCards(page);
    await expect(cards.first()).toBeVisible();
    const n = Math.min(await cards.count(), 6);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      // Occupancy on the card: two rooms, 3 adults + 1 child, 3 nights.
      await expect(card).toContainText('3 מבוגרים + ילד אחד');
      await expect(card).toContainText(`${nights} לילות`);
      await expect(card).toContainText(/2 × |×2/);
      // Cancellation terms visible on the card (free cancellation only was requested).
      await expect(card).toContainText(/ביטול חינם עד/);
    }
    for (const o of fresh.offers) {
      expect(o.cancellation.refundable).toBe(true);
      expect(o.details.rooms).toBe(2);
      expect(o.details.adults).toBe(3);
      expect(o.details.children).toBe(1);
    }

    // Detail dialog: the guests line and the full cancellation policy text.
    await cards.first().getByRole('button', { name: 'פרטים' }).click();
    const detail = page.getByTestId('offer-detail');
    await expect(detail).toContainText('2 חדרים · 3 מבוגרים · ילד אחד');
    await expect(detail).toContainText('ביטול ושינוי');
    await expect(detail).toContainText(/ביטול חינם עד \d{2}\/\d{2}\/\d{4}/);
    await expect(detail).toContainText('מס עירוני');
    await page.keyboard.press('Escape');

    // Same hotels without the free-cancellation restriction may show non-refundable rates, shown as such (API sanity).
    const all = await api.search('hotel', {
      destination: 'Athens',
      check_in: futureDate(checkIn),
      check_out: futureDate(checkIn + nights),
      rooms: [{ adults: 2, children_ages: [7] }, { adults: 1, children_ages: [] }],
      currency: 'ILS',
    });
    expect(all.offers.length).toBeGreaterThanOrEqual(fresh.offers.length);
  });

  test('V6-08 רכבים: הערת גיל נהג, פיקדון, מדיניות דלק וביטוחים', async ({ page, api }) => {
    const pickup = rnd(40, 200);
    await page.goto('/search/cars');
    await page.getByRole('combobox', { name: 'מקום איסוף' }).fill('ATH');
    await page.getByLabel('איסוף (תאריך ושעה מקומיים)').fill(`${futureDate(pickup)}T10:00`);
    await page.getByLabel('החזרה (תאריך ושעה מקומיים)').fill(`${futureDate(pickup + 4)}T10:00`);

    // A young driver gets an explicit note about the young-driver surcharge.
    await page.getByLabel('גיל הנהג').fill('22');
    await expect(page.getByText(/נהגים מתחת לגיל 25 עשויים לשלם תוספת נהג צעיר/)).toBeVisible();
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await expect(page).toHaveURL(/[?&]search_id=[0-9a-f]+/);
    const fresh = await (await page.request.get(`/api/search/${searchIdOf(page.url())}`)).json();
    expect(fresh.params.driver_age).toBe(22);

    const cards = offerCards(page);
    await expect(cards.first()).toBeVisible();
    const card = cards.first();
    await expect(card).toContainText('מדיניות דלק');
    await expect(card).toContainText(/ביטול חינם|ללא החזר|ניתן להחזר/);
    await card.getByRole('button', { name: 'פרטים' }).click();
    const detail = page.getByTestId('offer-detail');
    const offer = fresh.offers.find((o: { id: string }) => o.id === ((cards.first().getAttribute('data-offer-id')) as unknown as string)) ?? fresh.offers[0];
    for (const label of ['גיל נהג מינימלי', 'תוספת נהג צעיר', 'פיקדון', 'ביטוחים כלולים', 'מדיניות דלק', 'קילומטראז׳', 'איסוף', 'החזרה']) {
      await expect(detail, label).toContainText(label);
    }
    // Values come from the offer itself.
    const d = offer.details;
    await expect(detail).toContainText(String(d.driver_min_age));
    await expect(detail).toContainText(d.fuel_policy);
    for (const ins of d.insurance_included as string[]) await expect(detail).toContainText(ins);
    await expect(detail.locator('[data-amount]').filter({ hasText: /₪/ }).first()).toBeVisible();
    expect(Number(d.deposit.amount)).toBeGreaterThan(0);
    await expect(detail).toContainText(Number(d.deposit.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }));
    await expect(detail).toContainText('הדגמה');
    await page.keyboard.press('Escape');

    // Every car in the result set states a fuel policy, deposit and insurance list (nothing hidden / invented).
    for (const o of fresh.offers) {
      expect(o.details.fuel_policy, o.title).toBeTruthy();
      expect(o.details.deposit?.amount, o.title).toBeTruthy();
      expect(o.details.insurance_included.length, o.title).toBeGreaterThan(0);
      expect(typeof o.details.driver_min_age).toBe('number');
    }
    expect(api).toBeTruthy();
  });

  test('V6-09 אטרקציות: מספר משתתפים וגילאים, תאריכים זמינים בטווח', async ({ page }) => {
    const from = rnd(40, 200);
    await page.goto('/search/activities');
    await page.getByRole('combobox', { name: 'יעד (עיר)' }).fill('ATH');
    await page.getByLabel('מתאריך').fill(futureDate(from));
    await page.getByLabel('עד תאריך').fill(futureDate(from + 4));
    // 2 adults (default) + children aged 4 and 9.
    const add = page.getByRole('button', { name: 'הוספת ילד' });
    await add.click();
    await page.getByLabel('גיל ילד 1').selectOption('4');
    await add.click();
    await page.getByLabel('גיל ילד 2').selectOption('9');
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await expect(page).toHaveURL(/[?&]search_id=[0-9a-f]+/);

    const fresh = await (await page.request.get(`/api/search/${searchIdOf(page.url())}`)).json();
    expect(fresh.params.adults).toBe(2);
    expect(fresh.params.children_ages).toEqual([4, 9]);
    await expect(page.getByTestId('search-summary')).toContainText('2 מבוגרים + 2 ילדים');

    const cards = offerCards(page);
    await expect(cards.first()).toBeVisible();
    // Price breakdown is per participant type (adult x2, child x2), with a per-person price.
    await cards.first().getByRole('button', { name: 'פרטים' }).click();
    const detail = page.getByTestId('offer-detail');
    await expect(detail).toContainText('משתתפים');
    await expect(detail).toContainText('2 מבוגרים, 2 ילדים');
    await expect(detail).toContainText('כרטיסי מבוגר ×2');
    await expect(detail).toContainText('כרטיסי ילד ×2');
    await expect(detail).toContainText('לאדם');
    await expect(detail).toContainText('תאריכים זמינים');
    await page.keyboard.press('Escape');

    // Every activity lists participants and available dates that fall inside the searched range.
    const lo = futureDate(from);
    const hi = futureDate(from + 4);
    for (const o of fresh.offers) {
      expect(o.details.participants).toEqual({ adult: 2, child: 2, infant: 0 });
      expect(o.details.available_dates.length, o.title).toBeGreaterThan(0);
      for (const day of o.details.available_dates as string[]) {
        expect(day >= lo && day <= hi, `${o.title}: ${day} within ${lo}..${hi}`).toBe(true);
      }
    }
  });
});

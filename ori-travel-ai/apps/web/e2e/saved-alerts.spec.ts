import { expect } from '@playwright/test';
import { test } from './fixtures';
import { sharedFlightSearch } from './data';
import { uniq } from './env';

test.describe('הצעות שמורות והתראות מחיר', () => {
  const savedIds: string[] = [];
  const alertNames: string[] = [];
  test.afterAll(async ({ request }) => {
    const state = await request.storageState();
    const h = { 'X-CSRF-Token': state.cookies.find((c) => c.name === 'ori_csrf')?.value ?? '' };
    for (const id of savedIds) await request.delete(`/api/saved-offers/${id}`, { headers: h });
    const alerts = await (await request.get('/api/alerts')).json();
    for (const a of Array.isArray(alerts) ? alerts : (alerts.items ?? [])) {
      if (alertNames.includes(a.name)) await request.delete(`/api/alerts/${a.id}`, { headers: h });
    }
  });

  test('שמירת הצעה מופיעה ב"הצעות שמורות" ואפשר להסיר אותה', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const offer = search.offers[1 + Math.floor(Math.random() * 4)];
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const card = page.locator(`[data-testid="offer-card"][data-offer-id="${offer.id}"]`);
    await card.getByRole('button', { name: 'שמירה' }).click();
    await expect(page.getByText('ההצעה נשמרה').first()).toBeVisible();
    await expect(card.getByRole('button', { name: 'נשמרה' })).toBeDisabled();

    const saved = await (await api.get('/api/saved-offers')).json();
    const row = (Array.isArray(saved) ? saved : saved.items).find((s: { offer_id: string }) => s.offer_id === offer.id);
    expect(row, 'saved offer must be listed by the API').toBeTruthy();
    savedIds.push(row.id);

    await page.goto('/saved');
    const savedCard = page.locator(`[data-testid="offer-card"][data-offer-id="${offer.id}"]`);
    await expect(savedCard).toBeVisible();
    await expect(savedCard).toContainText('הדגמה');
    await expect(savedCard.getByRole('link', { name: 'הכנת הזמנה' })).toHaveAttribute('href', `/bookings?offer_id=${offer.id}`);
    await expect(page.getByRole('tab', { name: /טיסות \(\d+\)/ })).toBeVisible();

    await savedCard.getByRole('button', { name: 'הסרה מהרשימה' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    if (await confirm.count()) await confirm.getByRole('button', { name: /הסרה|אישור|כן/ }).last().click();
    await expect(savedCard).toHaveCount(0);
  });

  test('התראת מחיר מחיפוש: בדיקה ידנית, תמונת מחיר בהיסטוריה, וחסימת קירור בבדיקה השנייה', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    const name = uniq('התראה-');
    alertNames.push(name);

    // The search page offers the shortcut to the alert form.
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    await page.getByRole('link', { name: 'יצירת התראת מחיר לחיפוש הזה' }).click();
    await expect(page).toHaveURL(new RegExp(`/alerts\\?from_search=${search.search_id}`));

    const dlg = page.getByRole('dialog', { name: 'התראת מחיר חדשה' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: 'יעד (קוד שדה)' })).toHaveValue('ATH'); // prefilled from the search
    await dlg.getByRole('textbox', { name: /^שם ההתראה/ }).fill(name);
    await dlg.getByRole('button', { name: 'יצירת התראה' }).click();

    const card = page.getByRole('article', { name }).or(page.locator('article', { hasText: name })).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('טרם נבדקה');

    // First manual check succeeds and records a snapshot.
    await card.getByRole('button', { name: 'בדוק עכשיו' }).click();
    await expect(page.getByText('הבדיקה הושלמה').first()).toBeVisible();
    await expect(card).toContainText('נבדקה בהצלחה');
    await expect(card.getByText('הדגמה').first()).toBeVisible();
    const toggle = card.getByRole('button', { name: 'היסטוריית מחירים' });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const history = page.getByRole('table', { name: new RegExp(`היסטוריית בדיקות — ${name}`) });
    await expect(history).toBeVisible();
    await expect(history.locator('tbody tr')).toHaveCount(1);
    await expect(history).toContainText('₪');

    // A second check inside the cooldown is refused with a Hebrew explanation (and no new snapshot).
    await card.getByRole('button', { name: 'בדוק עכשיו' }).click();
    await expect(page.getByText(/פעם אחת כל 5 דקות/).first()).toBeVisible();
    await expect(page.getByText('אפשר לבדוק שוב בעוד כמה דקות')).toBeVisible();
    await expect(history.locator('tbody tr')).toHaveCount(1);
  });
});

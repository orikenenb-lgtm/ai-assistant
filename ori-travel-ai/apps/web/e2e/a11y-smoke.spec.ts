import { expect, type Page } from '@playwright/test';
import { anon, test } from './fixtures';
import { hotelSearch, sharedFlightSearch } from './data';
import { futureDate, uniq } from './env';
import type { Api } from './api';

/** Runs in the page: elements that are visible but have no accessible name / label. */
const FIND_UNNAMED = `(() => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
  const byId = (id) => { const n = document.getElementById(id); return n ? text(n) : ''; };
  const named = (el) => {
    if ((el.getAttribute('aria-label') || '').trim()) return true;
    const lb = el.getAttribute('aria-labelledby');
    if (lb && lb.split(/\\s+/).some((id) => byId(id))) return true;
    if (el.labels && el.labels.length > 0 && Array.from(el.labels).some((l) => text(l))) return true;
    if ((el.getAttribute('title') || '').trim()) return true;
    if (text(el)) return true;
    const img = el.querySelector('img[alt]:not([alt=""])');
    return !!img;
  };
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], a[href]'))
    .filter((el) => visible(el) && !el.closest('[aria-hidden="true"]') && !named(el));
  const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="slider"], [role="combobox"]'))
    .filter((el) => visible(el) && !el.closest('[aria-hidden="true"]') && !named(el));
  return {
    buttons: buttons.map((el) => el.outerHTML.slice(0, 160)),
    fields: fields.map((el) => el.outerHTML.slice(0, 160)),
  };
})()`;

async function expectBasicA11y(page: Page, label: string) {
  // Exactly one <h1>.
  await expect(page.locator('h1'), `${label}: exactly one h1`).toHaveCount(1);
  // Document language and direction.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  // Page has a title and a main landmark (except on the bare auth layout).
  expect((await page.title()).trim().length, `${label}: document title`).toBeGreaterThan(0);
  const res = (await page.evaluate(FIND_UNNAMED)) as { buttons: string[]; fields: string[] };
  expect(res.buttons, `${label}: controls without an accessible name`).toEqual([]);
  expect(res.fields, `${label}: form fields without a label`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const m = (await page.evaluate('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })')) as { sw: number; cw: number };
  expect(m.sw, `${label}: scrollWidth ${m.sw} must be <= clientWidth ${m.cw} at 390px`).toBeLessThanOrEqual(m.cw);
}

/** Fixtures for pages that need data: a trip with an item and a booking in review. */
async function seedPages(api: Api) {
  const search = await sharedFlightSearch(api);
  const offerId = search.offers[0].id;
  const trip = await api.json(await api.post('/api/trips', { title: uniq('נגישות-'), destination: 'Athens', start_date: futureDate(40), end_date: futureDate(47), traveler_ids: [] }));
  await api.json(await api.post(`/api/trips/${trip.id}/items/from-offer`, { offer_id: offerId }));
  const members = await api.json(await api.get('/api/family/members'));
  const booking = await api.json(await api.post('/api/bookings', { offer_id: offerId, traveler_member_ids: [members[0].id], simulation_scenario: 'success' }));
  await api.json(await api.post(`/api/bookings/${booking.id}/revalidate`));
  return { searchId: search.search_id, tripId: trip.id as string, bookingId: booking.id as string };
}

anon.describe('נגישות: דף ההתחברות (ללא משתמש)', () => {
  anon('מבנה בסיסי, תוויות, ללא גלישה אופקית ב-390px', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'התחברות' })).toBeVisible();
    await expectBasicA11y(page, 'login');
    // Labels are programmatically associated (click on label focuses the input).
    await page.locator('label').filter({ hasText: /^אימייל/ }).click();
    await expect(page.locator('input[name="email"]')).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, 'login');
  });

  anon('מקלדת: Tab מגיע לשדה האימייל, לסיסמה ולכפתור הכניסה; Enter שולח', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toBeVisible(); // wait for hydration before using the keyboard
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.push((await page.evaluate("document.activeElement && (document.activeElement.getAttribute('name') || document.activeElement.textContent || '').trim()")) as string);
    }
    expect(seen).toContain('email');
    expect(seen).toContain('password');
    expect(seen.some((s) => s.includes('כניסה'))).toBe(true);
  });
});

test.describe('נגישות: מסכים מרכזיים', () => {
  test('כל המסכים: h1 יחיד, dir/lang, שמות לכפתורים ותוויות לשדות', async ({ page, api }) => {
    const ids = await seedPages(api);
    const pages: Array<[string, string]> = [
      ['dashboard', '/'],
      ['flight search form', '/search/flights'],
      ['search results', `/search/flights?search_id=${ids.searchId}`],
      ['trip', `/trips/${ids.tripId}`],
      ['booking review', `/bookings/${ids.bookingId}`],
      ['trips', '/trips'],
      ['assistant', '/assistant'],
      ['family', '/family'],
      ['providers', '/providers'],
      ['settings', '/settings'],
    ];
    for (const [label, url] of pages) {
      await page.goto(url);
      await expect(page.locator('main h1, h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectBasicA11y(page, label);
    }
  });

  test('אין גלישה אופקית ב-390px בכל המסכים המרכזיים', async ({ page, api }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await seedPages(api);
    const pages: Array<[string, string]> = [
      ['flight search form', '/search/flights'],
      ['search results', `/search/flights?search_id=${ids.searchId}`],
      ['trip', `/trips/${ids.tripId}`],
      ['booking review', `/bookings/${ids.bookingId}`],
      ['assistant', '/assistant'],
      ['family', '/family'],
      ['providers', '/providers'],
      ['settings', '/settings'],
      ['compare', '/compare'],
    ];
    for (const [label, url] of pages) {
      await page.goto(url);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page, label);
    }
  });

  // BUG-QA-02 (layout, medium): with at least one recent search the dashboard is ~19px wider than a 390px phone
  // (scrollWidth 409 > clientWidth 390), so the whole app shell (fixed tab bar included) scrolls sideways.
  // Cause: the cards sit in `grid gap-6 lg:grid-cols-2` (implicit auto track) so a card's min-content width -- a flex
  // row with a nowrap title -- widens the track; `min-w-0` / `grid-cols-[minmax(0,1fr)]` on the grid fixes it.
  // Remove `test.fail` once fixed (the test will then report "expected to fail but passed").
  test('לוח הבקרה ב-390px עם חיפושים אחרונים: אין גלישה אופקית -- באג ידוע BUG-QA-02', async ({ page, api }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the overflow only reproduces in the mobile (touch, 390px) project');
    test.fail(true, 'BUG-QA-02: dashboard overflows horizontally at 390px when recent searches exist');
    // A hotel search with a long destination makes the nowrap title of the recent-search row wide.
    await hotelSearch(api, 45, 'Thessaloniki Macedonia Greece');
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText('החיפושים האחרונים שלך')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page, 'dashboard');
  });

  test('מקלדת: קישור דילוג לתוכן עובד ו-Tab מגיע לניווט הראשי', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // First Tab stop is the skip link; it is revealed on focus and jumps to #main.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'דילוג לתוכן הראשי' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    // The skip link moves focus to <main id="main"> itself (the app intercepts the anchor click).
    await expect(page.locator('main#main')).toBeFocused();
    // After skipping, the next Tab stays inside the main content, not in the navigation.
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate("!!document.activeElement && !!document.activeElement.closest('#main, main')");
    expect(inMain, 'focus must continue inside <main> after the skip link').toBe(true);

    // The main navigation is reachable by keyboard.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (testInfo.project.name === 'mobile') {
      let reached = false;
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = (await page.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label') === 'פתיחת תפריט הניווט'")) as boolean;
      }
      expect(reached, 'menu button reachable by Tab').toBe(true);
      await page.keyboard.press('Enter');
      const nav = page.getByRole('navigation', { name: 'ניווט ראשי' });
      await expect(nav).toBeVisible();
      await nav.getByRole('link', { name: 'טיסות' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/search\/flights/);
    } else {
      let inNav = false;
      for (let i = 0; i < 8 && !inNav; i++) {
        await page.keyboard.press('Tab');
        inNav = (await page.evaluate("!!document.activeElement && !!document.activeElement.closest('nav[aria-label=\"ניווט ראשי\"]')")) as boolean;
      }
      expect(inNav, 'Tab reaches the main navigation').toBe(true);
      // Enter on a focused nav link navigates.
      await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link', { name: 'טיסות' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/search\/flights/);
    }
  });

  test('דיאלוג: הפוקוס נלכד בתוך הדיאלוג ו-Escape סוגר אותו', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.locator('h1')).toBeVisible();
    const opener = page.getByRole('button', { name: 'טיול חדש' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'טיול חדש' });
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate("!!document.activeElement.closest('[role=\"dialog\"]')"), `focus escaped the dialog on Tab #${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('דיאלוג עם trigger מובנה (הוספה לטיול): הפוקוס חוזר לכפתור אחרי Escape', async ({ page, api }) => {
    const search = await sharedFlightSearch(api);
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const opener = page.locator('[data-testid="offer-card"]').first().getByRole('button', { name: 'הוספה לטיול' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'הוספה לטיול' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });

  // BUG-QA-01 (a11y, medium): dialogs that are opened from a plain <Button onClick> with controlled `open` state
  // (TripFormDialog, MemberFormDialog, InvitationsSection, StartBookingDialog ...) lose focus to <body> on close
  // instead of returning to the button that opened them. Only dialogs using the `trigger` prop restore focus.
  // Remove `test.fail` once fixed (this test will then report "expected to fail but passed").
  test('דיאלוג נשלט (יצירת טיול): הפוקוס חוזר לכפתור שפתח אותו -- באג ידוע BUG-QA-01', async ({ page }) => {
    test.fail(true, 'BUG-QA-01: focus is lost to <body> after closing a controlled dialog');
    await page.goto('/trips');
    await expect(page.locator('h1')).toBeVisible();
    const opener = page.getByRole('button', { name: 'טיול חדש' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'טיול חדש' });
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

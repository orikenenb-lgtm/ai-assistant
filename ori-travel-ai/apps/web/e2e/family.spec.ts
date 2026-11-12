import { expect } from '@playwright/test';
import { freshOwnerContext, test } from './fixtures';
import { Api } from './api';
import { flightSearch } from './data';
import { OWNER_PASSWORD, futureDate, uniq } from './env';

const PASSPORT = 'P7654321Z';
/** `browser.newContext()` inherits the owner storageState from the fixtures; guests must opt out explicitly. */
const ANON = { cookies: [], origins: [] };
const VIEWER_PASSWORD = 'Viewer-Pass-2026!x';

/** Family administration, sensitive traveler data and the invitation -> viewer lifecycle. */
test.describe.serial('משפחה, פרופיל נוסע והזמנות', () => {
  const memberName = uniq('בן-משפחה-');
  const viewerEmail = `${uniq('viewer')}@example.com`;
  const viewerName = uniq('צופה-');
  let tripId = '';
  let memberId = '';

  test.afterAll(async ({ request }) => {
    const state = await request.storageState();
    const h = { 'X-CSRF-Token': state.cookies.find((c) => c.name === 'ori_csrf')?.value ?? '' };
    if (tripId) await request.delete(`/api/trips/${tripId}`, { headers: h });
    if (memberId) await request.delete(`/api/family/members/${memberId}`, { headers: h });
    // Deactivate the viewer created by this spec so reruns stay tidy.
    const users = await (await request.get('/api/family/users')).json();
    for (const u of Array.isArray(users) ? users : (users.items ?? [])) {
      if (u.email === viewerEmail) await request.patch(`/api/family/users/${u.id}`, { headers: h, data: { is_active: false } });
    }
  });

  test('הוספה ועריכה של בן/בת משפחה', async ({ page }) => {
    await page.goto('/family');
    await page.getByRole('button', { name: 'בן/בת משפחה' }).click();
    const dlg = page.getByRole('dialog', { name: 'הוספת בן/בת משפחה' });

    // Required name.
    await dlg.getByRole('button', { name: 'הוספה', exact: true }).click();
    await expect(dlg.getByText(/יש להזין|שם.*חובה|נדרש/).first()).toBeVisible();

    await dlg.getByRole('textbox', { name: 'שם', exact: true }).fill(memberName);
    await dlg.getByRole('textbox', { name: /^קשר משפחתי/ }).fill('דוד');
    await dlg.getByRole('button', { name: 'הוספה', exact: true }).click();
    const card = page.locator('[data-testid="member-card"]', { hasText: memberName });
    await expect(card).toBeVisible();
    await expect(card).toContainText('דוד');
    await expect(card).toContainText('אין פרופיל נוסע');
    const members = await (await page.request.get('/api/family/members')).json();
    memberId = members.find((m: { display_name: string }) => m.display_name === memberName).id;

    await card.getByRole('button', { name: `עריכת ${memberName}` }).click();
    const edit = page.getByRole('dialog');
    await edit.getByRole('textbox', { name: /^קשר משפחתי/ }).fill('סבא');
    await edit.getByRole('button', { name: /^(שמירה|עדכון)/ }).click();
    await expect(card).toContainText('סבא');
  });

  test('פרופיל נוסע עם דרכון: תצוגה מוסתרת, חשיפה עם אימות סיסמה, והסתרה', async ({ page, browser, baseURL }, testInfo) => {
    await page.goto('/family');
    const card = page.locator('[data-testid="member-card"]', { hasText: memberName });
    await card.getByRole('button', { name: 'יצירת פרופיל נוסע' }).click();
    const dlg = page.getByRole('dialog', { name: new RegExp(`פרופיל נוסע — ${memberName}`) });
    await dlg.getByRole('button', { name: 'יצירת פרופיל' }).click();

    // Validation: first/last name and date of birth are required.
    await dlg.getByRole('button', { name: 'שמירת הפרופיל' }).click();
    await expect(dlg.getByText(/יש להזין|נדרש|חובה/).first()).toBeVisible();

    await dlg.getByLabel(/שם פרטי/).fill('David');
    await dlg.getByLabel(/שם משפחה/).fill('Levi');
    await dlg.getByLabel('תאריך לידה').fill('1955-03-04');
    await dlg.getByLabel('מספר דרכון').fill(PASSPORT);
    await dlg.getByLabel('תוקף הדרכון').fill(futureDate(900));
    await dlg.getByRole('button', { name: 'שמירת הפרופיל' }).click();

    // Saved: legal name visible, passport masked (never shown in full by default).
    await expect(dlg.getByText('David Levi')).toBeVisible();
    const value = dlg.getByTestId('passport-value');
    await expect(value).toContainText('••••');
    await expect(value).toContainText(PASSPORT.slice(-3));
    await expect(dlg).not.toContainText(PASSPORT);
    // The full number is not in the list API payload either.
    const list = await (await page.request.get('/api/travelers')).text();
    expect(list).not.toContain(PASSPORT);

    // Reveal needs a fresh password check. Use a brand-new owner session (no recent re-authentication).
    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const ctx = await freshOwnerContext(browser, baseURL!, viewport);
    const fp = await ctx.newPage();
    await fp.goto('/family');
    await fp.locator('[data-testid="member-card"]', { hasText: memberName }).getByRole('button', { name: 'פרופיל נוסע' }).click();
    const fdlg = fp.getByRole('dialog', { name: new RegExp(`פרופיל נוסע — ${memberName}`) });
    const fvalue = fdlg.getByTestId('passport-value');
    await expect(fvalue).toContainText('••••');
    await fdlg.getByRole('button', { name: 'הצג מספר דרכון' }).click();
    const reauth = fp.getByRole('dialog', { name: 'אימות סיסמה' });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel('הסיסמה שלך').fill('Wrong-Password-123');
    await reauth.getByRole('button', { name: 'אימות והצגה' }).click();
    await expect(reauth.getByText('הסיסמה שגויה')).toBeVisible();
    await expect(fvalue).not.toHaveText(PASSPORT);

    await reauth.getByLabel('הסיסמה שלך').fill(OWNER_PASSWORD);
    await reauth.getByRole('button', { name: 'אימות והצגה' }).click();
    await expect(fvalue).toHaveText(PASSPORT);
    await expect(fdlg.getByText(/יוסתר בעוד \d+ שניות/)).toBeVisible();

    // Manual hide restores the mask.
    await fdlg.getByRole('button', { name: 'הסתרה' }).click();
    await expect(fvalue).toContainText('••••');
    await expect(fvalue).not.toHaveText(PASSPORT);
    await ctx.close();
  });

  test('הזמנה: יצירה, העתקת קישור, הצטרפות בהקשר דפדפן חדש כצופה, וממשק לקריאה בלבד', async ({ page, api, browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    // A trip + an offer for the viewer to look at.
    const created = await api.json(await api.post('/api/trips', { title: uniq('טיול-צופה-'), destination: 'Rome', start_date: futureDate(60), end_date: futureDate(65), traveler_ids: [] }));
    tripId = created.id;
    const search = await flightSearch(api, { adults: 1 });

    // --- owner creates the invitation
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/family');
    await page.getByRole('button', { name: 'הזמנה חדשה' }).click();
    const dlg = page.getByRole('dialog', { name: 'הזמנת בן/בת משפחה' });
    // Validation first.
    await dlg.getByRole('button', { name: 'יצירת קישור הזמנה' }).click();
    await expect(dlg.getByText(/יש להזין|נדרש|חובה|אינה תקינה/).first()).toBeVisible();
    await dlg.getByRole('textbox', { name: /^אימייל/ }).fill(viewerEmail);
    await dlg.getByRole('textbox', { name: /^שם/ }).fill(viewerName);
    await dlg.getByRole('combobox', { name: 'תפקיד' }).selectOption({ label: 'צופה' });
    await dlg.getByRole('button', { name: 'יצירת קישור הזמנה' }).click();

    const link = page.getByRole('textbox', { name: 'קישור ההזמנה' });
    await expect(link).toBeVisible();
    const inviteUrl = await link.inputValue();
    expect(inviteUrl).toMatch(/\/invite[/#]/);
    expect(inviteUrl.startsWith(baseURL!)).toBe(true);
    await page.getByRole('button', { name: 'העתקה' }).click();
    await expect(page.getByRole('button', { name: 'הועתק' })).toBeVisible();
    expect(await page.evaluate('navigator.clipboard.readText()')).toBe(inviteUrl);

    // --- the invitee opens it in a brand-new, anonymous browser context
    const viewport = testInfo.project.use.viewport ?? { width: 1440, height: 900 };
    const guest = await browser.newContext({ baseURL, locale: 'he-IL', viewport, storageState: ANON });
    const gp = await guest.newPage();
    await gp.goto(inviteUrl);
    await expect(gp.getByRole('heading', { level: 1, name: new RegExp(`שלום ${viewerName}`) })).toBeVisible();
    await expect(gp.getByText(viewerEmail)).toBeVisible();
    await expect(gp.getByText('צופה', { exact: true }).first()).toBeVisible();

    // Weak / mismatching passwords are rejected before anything is created.
    await gp.locator('input[name="new-password"]').fill('short');
    await gp.getByLabel('אימות סיסמה').fill('different');
    await gp.getByRole('button', { name: 'יצירת סיסמה והצטרפות' }).click();
    await expect(gp).toHaveURL(/\/invite/);
    await expect(gp.getByText(/10 תווים|חלשה|לא תואמת|אינה זהה|לא זהות/).first()).toBeVisible();

    await gp.locator('input[name="new-password"]').fill(VIEWER_PASSWORD);
    await gp.getByLabel('אימות סיסמה').fill(VIEWER_PASSWORD);
    await gp.getByRole('button', { name: 'יצירת סיסמה והצטרפות' }).click();
    await expect(gp).toHaveURL(/\/$/);
    const me = await (await guest.request.get('/api/auth/me')).json();
    expect(me.user.role).toBe('viewer');
    expect(me.user.email).toBe(viewerEmail);
    expect(me.user.can_book).toBe(false);

    // --- read-only UI
    await gp.getByRole('button', { name: /תפריט משתמש/ }).click();
    await expect(gp.getByText('צופה', { exact: true }).first()).toBeVisible();
    await gp.keyboard.press('Escape');

    await gp.goto('/trips');
    await expect(gp.getByRole('heading', { level: 1, name: 'טיולים' })).toBeVisible();
    await expect(gp.getByRole('button', { name: 'טיול חדש' })).toHaveCount(0);
    await gp.goto(`/trips/${tripId}`);
    await expect(gp.getByRole('heading', { level: 1 })).toBeVisible();
    for (const name of ['עריכה', 'מחיקה', 'פריט ידני']) {
      await expect(gp.getByRole('button', { name, exact: true }), `viewer must not see "${name}"`).toHaveCount(0);
    }

    await gp.goto('/bookings');
    await expect(gp.getByTestId('read-only-note')).toBeVisible();
    await expect(gp.getByRole('button', { name: 'הכנת הזמנה חדשה' })).toHaveCount(0);

    // Viewers may search (their own search), but cannot add to trips / alerts / bookings.
    const viewerSearch = await flightSearch(new Api(guest.request), { adults: 1 });
    await gp.goto(`/search/flights?search_id=${viewerSearch.search_id}`);
    const card = gp.locator('[data-testid="offer-card"]').first();
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'הוספה לטיול' })).toHaveCount(0);
    await expect(gp.getByRole('link', { name: 'יצירת התראת מחיר לחיפוש הזה' })).toHaveCount(0);
    await card.getByRole('button', { name: 'פרטים' }).click();
    await expect(gp.getByRole('dialog').getByRole('link', { name: 'הכנת הזמנה' })).toHaveCount(0);
    await gp.keyboard.press('Escape');

    await gp.goto('/family');
    await expect(gp.getByRole('button', { name: 'בן/בת משפחה' })).toHaveCount(0);
    await expect(gp.getByRole('button', { name: 'הזמנה חדשה' })).toHaveCount(0);

    // --- server-side enforcement: mutating calls as the viewer are forbidden (403), reads still work
    const cookies = await guest.cookies();
    const csrf = cookies.find((c) => c.name === 'ori_csrf')?.value ?? '';
    const h = { 'X-CSRF-Token': csrf };
    const attempts: Array<[string, string, unknown]> = [
      ['post', '/api/trips', { title: 'viewer should not create', traveler_ids: [] }],
      ['patch', `/api/trips/${tripId}`, { title: 'hacked' }],
      ['delete', `/api/trips/${tripId}`, undefined],
      ['post', '/api/family/members', { display_name: 'x', age_group: 'adult', is_minor: false }],
      ['post', '/api/family/invitations', { email: 'y@example.com', display_name: 'y', role: 'viewer', legal_adult_attested: false }],
      ['post', '/api/bookings', { offer_id: search.offers[0].id, traveler_member_ids: [memberId] }],
      ['put', '/api/settings/ranking-weights', { cost: 25, convenience: 25, flexibility: 25, quality: 25 }],
    ];
    for (const [method, path, data] of attempts) {
      const res = await guest.request.fetch(path, { method: method.toUpperCase(), data: data ?? undefined, headers: h });
      expect(res.status(), `${method.toUpperCase()} ${path} as viewer`).toBe(403);
      const body = await res.json();
      expect(body.error.message).toMatch(/[א-ת]/); // Hebrew error envelope
    }
    expect((await guest.request.get('/api/trips')).status()).toBe(200);
    // The trip is untouched.
    const still = await api.json(await api.get(`/api/trips/${tripId}`));
    expect(still.title).not.toBe('hacked');

    // --- a used invitation link cannot be reused
    const second = await browser.newContext({ baseURL, locale: 'he-IL', viewport, storageState: ANON });
    const sp = await second.newPage();
    await sp.goto(inviteUrl);
    await expect(sp.getByText('ההזמנה אינה תקפה או שפג תוקפה')).toBeVisible();
    await second.close();
    await guest.close();
  });
});

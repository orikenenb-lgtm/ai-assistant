import { expect, type Page, type TestInfo } from '@playwright/test';

export const isMobileProject = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

export const offerCards = (page: Page) => page.locator('[data-testid="offer-card"]');

/** Snapshot of the visible ranking: ids in order + the "ציון כולל" text of each card. */
export async function rankingSnapshot(page: Page) {
  const cards = offerCards(page);
  const n = await cards.count();
  const ids: string[] = [];
  const scores: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push((await cards.nth(i).getAttribute('data-offer-id')) ?? '');
    const text = (await cards.nth(i).innerText()).replace(/\s+/g, ' ');
    scores.push(/ציון כולל:?\s*([\d.]+)/.exec(text)?.[1] ?? '?');
  }
  return { ids, scores };
}

/** Common assertions every finished search must satisfy. */
export async function expectSearchResults(page: Page, opts: { liveNotConnected?: boolean } = {}) {
  const { liveNotConnected = true } = opts;
  await expect(page).toHaveURL(/[?&]search_id=[0-9a-f]+/);
  const results = page.getByTestId('search-results');
  await expect(results).toBeVisible();
  const cards = offerCards(page);
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  // Provider status strip: DEMO providers answered, live providers show "not connected".
  const strip = page.getByTestId('provider-strip');
  await expect(strip).toBeVisible();
  // A fresh run reports "תקין"; an identical repeated search may be served from the provider cache ("שמור במטמון").
  await expect(strip).toContainText(/תקין|שמור במטמון/);
  // Categories that have live adapters (flights, hotels, activities) list them as "not connected"; cars has none.
  if (liveNotConnected) await expect(strip).toContainText('לא מחובר');
  await expect(strip).toContainText('הדגמה');

  // Coverage note (honest about partial market coverage) + DEMO disclaimer.
  await expect(page.getByText('כיסוי החיפוש', { exact: true })).toBeVisible();
  await expect(page.getByText(/אין התחייבות לכיסוי מלא/)).toBeVisible();
  await expect(page.getByText('חלק מהתוצאות הן נתוני הדגמה')).toBeVisible();

  // Every offer card carries the DEMO badge (source line "מקור נתונים: הדגמה").
  const total = await cards.count();
  for (let i = 0; i < total; i++) {
    const src = cards.nth(i).getByTestId('source-line');
    await expect(src, `offer card #${i} must show the DEMO badge`).toContainText('הדגמה');
  }
  // And no card claims to be live.
  await expect(page.locator('[data-testid="source-line"]', { hasText: /מקור נתונים:\s*חי/ })).toHaveCount(0);
}

/** `?search_id=` must survive a full reload and render the same results. */
export async function expectSurvivesReload(page: Page) {
  const url = page.url();
  const idsBefore = (await rankingSnapshot(page)).ids.slice(0, 3);
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(offerCards(page).first()).toBeVisible();
  const idsAfter = (await rankingSnapshot(page)).ids.slice(0, 3);
  expect(idsAfter).toEqual(idsBefore);
  await expect(page.getByTestId('provider-strip')).toBeVisible();
}

/** Returns the container holding the re-rank controls (sidebar on desktop, drawer on mobile). */
export async function openRankPanel(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: /^דירוג וסינון/ }).click();
    const dlg = page.getByRole('dialog', { name: 'דירוג וסינון' });
    await expect(dlg).toBeVisible();
    return dlg;
  }
  return page.getByRole('complementary', { name: 'דירוג וסינון' });
}

/** Applies the given preset in the rank panel and asserts the ranking/score changed. */
export async function expectRerankChangesResult(page: Page, mobile: boolean, preset = 'הכי זול') {
  const before = await rankingSnapshot(page);
  const panel = await openRankPanel(page, mobile);
  await panel.getByRole('button', { name: preset, exact: true }).click();
  const apply = panel.getByRole('button', { name: 'החלת הדירוג' });
  await expect(apply).toBeEnabled();
  await apply.click();
  if (mobile) {
    await page.getByRole('button', { name: /^הצגת \d+ הצעות/ }).click();
    await expect(page.getByRole('dialog', { name: 'דירוג וסינון' })).toBeHidden();
  }
  await expect(page.getByText('דירוג מותאם', { exact: true })).toBeVisible();
  await expect.poll(async () => JSON.stringify(await rankingSnapshot(page)), { timeout: 10_000 }).not.toBe(JSON.stringify(before));
  const after = await rankingSnapshot(page);
  // The order or at least one score must differ from the default weighting.
  const orderChanged = JSON.stringify(after.ids) !== JSON.stringify(before.ids);
  const scoresChanged = JSON.stringify(after.scores) !== JSON.stringify(before.scores);
  expect(orderChanged || scoresChanged).toBe(true);
}

/** Opens the first offer's detail dialog and checks the essentials. */
export async function expectOfferDetails(page: Page) {
  await offerCards(page).first().getByRole('button', { name: 'פרטים' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  const detail = dlg.getByTestId('offer-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('הדגמה');
  await expect(detail).toContainText(/פירוט מחיר|מחיר/);
  await expect(detail).toContainText('איך חושב הציון');
  await closeTopDialog(page);
}

/** Escape closes the topmost layer; an open hover tooltip inside the dialog may take the first Escape. */
export async function closeTopDialog(page: Page) {
  const dlg = page.getByRole('dialog');
  for (let i = 0; i < 3 && (await dlg.count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await expect(dlg).toBeHidden();
}

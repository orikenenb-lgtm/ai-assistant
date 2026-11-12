import { expect } from '@playwright/test';
import { test } from './fixtures';
import { futureDate } from './env';
import { expectOfferDetails, expectRerankChangesResult, expectSearchResults, expectSurvivesReload, isMobileProject } from './search-common';

const PICKUP = 'איסוף (תאריך ושעה מקומיים)';
const DROPOFF = 'החזרה (תאריך ושעה מקומיים)';

test.describe('חיפוש רכבים', () => {
  test('ולידציה בצד הלקוח: איסוף בעבר, החזרה לפני האיסוף, גיל נהג', async ({ page }) => {
    await page.goto('/search/cars');
    const search = page.getByRole('button', { name: 'חיפוש', exact: true });

    await page.getByRole('combobox', { name: 'מקום איסוף' }).fill('TLV');
    await page.getByLabel(PICKUP).fill('2020-05-01T10:00');
    await page.getByLabel(DROPOFF).fill('2020-05-03T10:00');
    await search.click();
    await expect(page.getByText('התאריך כבר עבר').first()).toBeVisible();

    await page.getByLabel(PICKUP).fill(`${futureDate(30)}T10:00`);
    await page.getByLabel(DROPOFF).fill(`${futureDate(29)}T10:00`);
    await search.click();
    await expect(page.getByText('זמן ההחזרה חייב להיות לפחות שעה אחרי האיסוף')).toBeVisible();

    await page.getByLabel(DROPOFF).fill(`${futureDate(33)}T10:00`);
    await page.getByLabel('גיל הנהג').fill('17');
    await search.click();
    await expect(page.getByText('גיל נהג מינימלי 18')).toBeVisible();
    await expect(page).not.toHaveURL(/search_id/);
  });

  test('חיפוש מלא: תוצאות, DEMO, פס ספקים, כיסוי, טעינה מחדש, דירוג מחדש ופרטים', async ({ page }, testInfo) => {
    await page.goto('/search/cars');
    await page.getByRole('combobox', { name: 'מקום איסוף' }).fill('ATH');
    await page.getByLabel(PICKUP).fill(`${futureDate(30)}T10:00`);
    await page.getByLabel(DROPOFF).fill(`${futureDate(34)}T10:00`);
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();

    await expectSearchResults(page);
    await expectSurvivesReload(page);
    await expectRerankChangesResult(page, isMobileProject(testInfo));
    await expectOfferDetails(page);
  });
});

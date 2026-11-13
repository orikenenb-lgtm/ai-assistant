import { expect } from '@playwright/test';
import { test } from './fixtures';
import { futureDate } from './env';
import { expectOfferDetails, expectRerankChangesResult, expectSearchResults, expectSurvivesReload, isMobileProject } from './search-common';

test.describe('חיפוש טיסות', () => {
  test('ולידציה בצד הלקוח: תאריך עבר, חזרה לפני יציאה, מוצא=יעד', async ({ page }) => {
    await page.goto('/search/flights');
    const search = page.getByRole('button', { name: 'חיפוש', exact: true });

    // Past departure date.
    await page.getByRole('combobox', { name: 'יעד' }).fill('ATH');
    await page.getByLabel('תאריך יציאה').fill('2020-01-10');
    await page.getByLabel('תאריך חזרה').fill('2020-01-20');
    await search.click();
    await expect(page.getByText('התאריך כבר עבר').first()).toBeVisible();
    await expect(page).not.toHaveURL(/search_id/);

    // Return before departure.
    await page.getByLabel('תאריך יציאה').fill(futureDate(40));
    await page.getByLabel('תאריך חזרה').fill(futureDate(35));
    await search.click();
    await expect(page.getByText('תאריך החזרה חייב להיות אחרי תאריך היציאה')).toBeVisible();

    // Same origin and destination.
    await page.getByLabel('תאריך חזרה').fill(futureDate(47));
    await page.getByRole('combobox', { name: 'יעד' }).fill('TLV');
    await search.click();
    await expect(page.getByText('מוצא ויעד חייבים להיות שונים')).toBeVisible();

    // Invalid IATA code.
    await page.getByRole('combobox', { name: 'יעד' }).fill('A1');
    await search.click();
    await expect(page.getByText(/קוד שדה תעופה בן 3 אותיות/)).toBeVisible();
    await expect(page).not.toHaveURL(/search_id/);
  });

  test('חיפוש מלא: תוצאות, DEMO, פס ספקים, כיסוי, טעינה מחדש, דירוג מחדש ופרטים', async ({ page }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    await page.goto('/search/flights');
    await page.getByRole('combobox', { name: 'יעד' }).fill('ATH');
    await page.getByRole('option', { name: /ATH/ }).click();
    await page.getByLabel('תאריך יציאה').fill(futureDate(30));
    await page.getByLabel('תאריך חזרה').fill(futureDate(37));
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();

    await expectSearchResults(page);
    await expect(page.getByTestId('search-summary')).toContainText('TLV');
    await expect(page.getByTestId('search-summary')).toContainText('ATH');

    await expectSurvivesReload(page);
    await expectRerankChangesResult(page, mobile);
    await expectOfferDetails(page);
  });
});

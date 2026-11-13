import { expect } from '@playwright/test';
import { test } from './fixtures';
import { futureDate } from './env';
import { expectOfferDetails, expectRerankChangesResult, expectSearchResults, expectSurvivesReload, isMobileProject } from './search-common';

test.describe('חיפוש אטרקציות', () => {
  test('ולידציה בצד הלקוח: יעד קצר, תאריך עבר, טווח הפוך', async ({ page }) => {
    await page.goto('/search/activities');
    const search = page.getByRole('button', { name: 'חיפוש', exact: true });

    await page.getByRole('combobox', { name: 'יעד (עיר)' }).fill('A');
    await search.click();
    await expect(page.getByText('יעד באורך 2 תווים לפחות')).toBeVisible();

    await page.getByRole('combobox', { name: 'יעד (עיר)' }).fill('Athens');
    await page.getByLabel('מתאריך').fill('2020-03-01');
    await page.getByLabel('עד תאריך').fill('2020-03-05');
    await search.click();
    await expect(page.getByText('התאריך כבר עבר').first()).toBeVisible();

    await page.getByLabel('מתאריך').fill(futureDate(40));
    await page.getByLabel('עד תאריך').fill(futureDate(36));
    await search.click();
    await expect(page.getByText('טווח התאריכים אינו תקין')).toBeVisible();
    await expect(page).not.toHaveURL(/search_id/);
  });

  test('חיפוש מלא: תוצאות, DEMO, פס ספקים, כיסוי, טעינה מחדש, דירוג מחדש ופרטים', async ({ page }, testInfo) => {
    await page.goto('/search/activities');
    await page.getByRole('combobox', { name: 'יעד (עיר)' }).fill('ATH');
    await page.getByLabel('מתאריך').fill(futureDate(30));
    await page.getByLabel('עד תאריך').fill(futureDate(34));
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();

    await expectSearchResults(page);
    await expectSurvivesReload(page);
    await expectRerankChangesResult(page, isMobileProject(testInfo));
    await expectOfferDetails(page);
  });
});

import { expect } from '@playwright/test';
import { test } from './fixtures';
import { flightSearch } from './data';

test.describe('השוואת הצעות', () => {
  test('בחירת שתי הצעות, טבלת השוואה עם שורות ציון, וניקוי הבחירה', async ({ page, api }) => {
    const search = await flightSearch(api, { nights: 5, adults: 2 });
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    const cards = page.locator('[data-testid="offer-card"]');
    await expect(cards.first()).toBeVisible();

    const bar = page.getByRole('region', { name: 'הצעות שנבחרו להשוואה' });
    await expect(bar).toHaveCount(0);

    await cards.nth(0).getByRole('button', { name: 'השוואה' }).click();
    // One offer is not enough: the compare action stays disabled and says so.
    await expect(bar).toContainText('1 הצעות נבחרו להשוואה');
    await expect(bar).toContainText('בחרו לפחות 2');
    await expect(bar.getByRole('button', { name: 'השוואה' })).toBeDisabled();

    await cards.nth(1).getByRole('button', { name: 'השוואה' }).click();
    await expect(cards.nth(0).getByRole('button', { name: 'נבחרה להשוואה' })).toHaveAttribute('aria-pressed', 'true');
    await bar.getByRole('link', { name: 'השוואה' }).click();

    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.getByRole('heading', { level: 1, name: 'השוואת הצעות' })).toBeVisible();
    const table = page.getByRole('table', { name: /טבלת השוואה: טיסות/ });
    await expect(table).toBeVisible();
    // Two offer columns (+ the row-header column).
    await expect(table.locator('thead th[scope="col"], thead [role="columnheader"]')).toHaveCount(3);
    for (const row of ['סה״כ ידוע', 'ציון כולל', 'עלות', 'נוחות', 'גמישות', 'איכות', 'למה הציון']) {
      await expect(table.getByRole('rowheader', { name: row, exact: true }).first(), `row "${row}"`).toBeVisible();
    }
    await expect(page.getByText('חלק מההצעות הן נתוני הדגמה')).toBeVisible();
    // Scores are numeric and out of 100.
    const scoreRow = table.getByRole('row', { name: /^ציון כולל/ });
    await expect(scoreRow).toContainText(/\d+\.\d/);

    // Selection survives a reload (kept in sessionStorage) ...
    await page.reload();
    await expect(table).toBeVisible();

    // ... and clearing it empties the page.
    await page.getByRole('button', { name: /ניקוי הבחירה/ }).click();
    await expect(table).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'השוואת הצעות' })).toBeVisible();
    await expect(page.getByText('עוד לא נבחרו הצעות להשוואה')).toBeVisible();
    // Search page no longer shows a selection bar.
    await page.goto(`/search/flights?search_id=${search.search_id}`);
    await expect(page.getByRole('region', { name: 'הצעות שנבחרו להשוואה' })).toHaveCount(0);
  });
});

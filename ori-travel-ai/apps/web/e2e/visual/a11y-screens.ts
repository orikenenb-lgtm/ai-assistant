import { expect, type Page } from '@playwright/test';
import { gotoFlightResults, openBookingReview, settle, type Fixtures } from './helpers';

export interface A11yScreen {
  id: string;
  anon?: boolean;
  /** Navigates and waits for the screen to be ready. */
  open: (page: Page, f: Fixtures) => Promise<void>;
  /** Whether the page is expected to render a <main> landmark and an <h1>. */
  expectH1?: boolean;
}

export const A11Y_SCREENS: A11yScreen[] = [
  { id: 'login', anon: true, open: async (p) => { await p.goto('/login'); await expect(p.locator('h1')).toBeVisible(); } },
  { id: 'dashboard', open: async (p) => { await p.goto('/'); await expect(p.locator('h1')).toBeVisible(); await settle(p); } },
  { id: 'flights-form', open: async (p) => { await p.goto('/search/flights'); await expect(p.getByTestId('flight-search-form')).toBeVisible(); await settle(p); } },
  { id: 'flights-results', open: async (p, f) => { await gotoFlightResults(p, f); } },
  {
    id: 'flights-results-table',
    open: async (p, f) => {
      await gotoFlightResults(p, f);
      const t = p.getByRole('group', { name: 'תצוגת התוצאות' }).getByRole('button', { name: 'טבלה' });
      if (await t.isVisible()) { await t.click(); await expect(p.getByTestId('results-table')).toBeVisible(); }
    },
  },
  { id: 'hotels-results', open: async (p, f) => { await p.goto(`/search/hotels?search_id=${f.hotelSearchId}`); await expect(p.getByTestId('offer-card').first()).toBeVisible(); await settle(p); } },
  { id: 'trip-detail', open: async (p, f) => { await p.goto(`/trips/${f.tripId}`); await expect(p.getByTestId('overlap-badge').first()).toBeVisible(); await settle(p); } },
  { id: 'booking-review', open: async (p, f) => { await openBookingReview(p, f); await settle(p); } },
  { id: 'demo-supplier', expectH1: true, open: async (p, f) => { await p.goto(f.checkoutUrl); await expect(p.getByText('דף ספק לדוגמה — DEMO, אין חיוב').first()).toBeVisible(); await settle(p); } },
  { id: 'family', open: async (p) => { await p.goto('/family'); await expect(p.locator('h1')).toBeVisible(); await settle(p); } },
  { id: 'settings', open: async (p) => { await p.goto('/settings'); await expect(p.locator('h1')).toBeVisible(); await settle(p); } },
];

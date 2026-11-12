import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration. Specs live in ./e2e (written by the QA agent).
 *
 * The suite expects a running API + web app. By default it targets the Vite
 * dev server; set E2E_BASE_URL to test the FastAPI-served build instead
 * (e.g. E2E_BASE_URL=http://127.0.0.1:8000).
 *
 * Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) and
 * pinned to @playwright/test 1.63.0 — do not run `playwright install`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});

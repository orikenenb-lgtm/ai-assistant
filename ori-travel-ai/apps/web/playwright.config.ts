import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration. Specs live in ./e2e (written by the QA agent).
 *
 * The suite expects a running API + web app. By default it targets the Vite
 * dev server; set E2E_BASE_URL to test the FastAPI-served build instead
 * (e.g. E2E_BASE_URL=http://127.0.0.1:8000).
 *
 * @playwright/test is pinned to 1.63.0. In the cloud build sandbox Chromium is
 * pre-installed (/opt/pw-browsers). On Windows, a fresh machine or CI run
 * `npx playwright install chromium` once.
 */
export default defineConfig({
  testDir: './e2e',
  // Functional specs run by default (`npm run e2e`); visual specs (agent VIS-A11Y) live in e2e/visual and run with
  // `npm run e2e -- e2e/visual` (or E2E_VISUAL=1). Passing the folder on the CLI still works because the filter
  // below is only applied when no visual run was requested.
  testIgnore: process.env.E2E_VISUAL === '1' || process.argv.some((a) => a.replace(/\\/g, '/').includes('e2e/visual')) ? [] : ['**/visual/**'],
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

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_e2e";

// The sandbox ships Chromium at a fixed path; CI uses Playwright's own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.CI ? undefined : "/opt/pw-browsers/chromium");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ENV: "test",
      APP_URL: BASE_URL,
      DATABASE_URL: E2E_DATABASE_URL,
      ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      CRON_SECRET: "e2e-cron-secret",
      AUTH_PROVIDER: "local",
      EMAIL_PROVIDER: "log",
      AI_PROVIDER: "mock",
      WHATSAPP_PROVIDER: "mock",
      META_APP_SECRET: "e2e-meta-secret",
      META_WEBHOOK_VERIFY_TOKEN: "e2e-verify-token",
      BILLING_PROVIDER: "mock",
      STORAGE_PROVIDER: "local",
      LOCAL_STORAGE_DIR: ".data/e2e-storage",
      LOG_LEVEL: "warn",
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
export const HOOK_PORT = Number(process.env.E2E_HOOK_PORT ?? 3299);

// The sandbox ships Chromium at a fixed path; CI uses Playwright's own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.CI ? undefined : "/opt/pw-browsers/chromium");
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
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
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      LEAD_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/hook`,
      LEAD_WEBHOOK_SECRET: "e2e-secret",
      AGENT_MODE: "rules",
      // Every spec posts leads from 127.0.0.1; keep the production default (6/h) elsewhere.
      LEAD_RATE_LIMIT_PER_HOUR: "500",
    },
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
};

const testEnv = {
  APP_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_test",
  ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  CRON_SECRET: "test-cron-secret",
  META_APP_SECRET: "test-meta-app-secret",
  META_WEBHOOK_VERIFY_TOKEN: "test-verify-token",
  LOG_LEVEL: "silent",
  LOCAL_STORAGE_DIR: ".data/test-storage",
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env: testEnv,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env: testEnv,
          globalSetup: ["tests/support/global-setup.ts"],
          // One shared database: run files serially for deterministic state.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

import { execFileSync } from "node:child_process";
import path from "node:path";

/** Rebuilds the integration database from migrations once per test run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_test";
  execFileSync("npx", ["tsx", path.resolve(import.meta.dirname, "../../scripts/db.ts"), "reset"], {
    env: { ...process.env, DATABASE_URL: url, APP_ENV: "test" },
    stdio: "inherit",
  });
}

import { execFileSync } from "node:child_process";
import path from "node:path";

export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_e2e";
  execFileSync("npx", ["tsx", path.resolve(import.meta.dirname, "../../scripts/db.ts"), "reset"], {
    env: { ...process.env, DATABASE_URL: url, APP_ENV: "test" },
    stdio: "inherit",
  });
}

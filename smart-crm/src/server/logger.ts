import pino from "pino";

// Keys whose values must never reach logs, at any nesting depth we care about.
const REDACT = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "accessToken",
  "access_token",
  "apiKey",
  "secret",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.access_token",
  "*.apiKey",
  "*.secret",
  "*.authorization",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
];

type Globals = { __crmLogger?: pino.Logger };
const g = globalThis as unknown as Globals;

export function logger(): pino.Logger {
  if (!g.__crmLogger) {
    g.__crmLogger = pino({
      level: process.env.LOG_LEVEL ?? (process.env.APP_ENV === "test" ? "silent" : "info"),
      base: { service: process.env.SERVICE_NAME ?? "smart-crm", env: process.env.APP_ENV ?? "development" },
      redact: { paths: REDACT, censor: "[redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return g.__crmLogger;
}

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { err: { name: e.name, message: e.message, stack: e.stack } };
  return { err: String(e) };
}

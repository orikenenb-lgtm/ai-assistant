import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // 32 random bytes, base64. Root key for token encryption and derived signing keys.
    ENCRYPTION_KEY: z.string().min(1),
    CRON_SECRET: optionalString,

    AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    /** Sign-ups allowed per client IP per hour (abuse protection; raised only for E2E suites). */
    AUTH_SIGNUP_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(10),
    NEXT_PUBLIC_SUPABASE_URL: optionalString,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
    SUPABASE_STORAGE_BUCKET: z.string().default("crm-files"),

    EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.string().default("SMART CRM AI <no-reply@example.com>"),

    AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: z.string().default("gpt-5-mini"),
    // USD per 1M tokens for cost metering; verify against current OpenAI pricing.
    OPENAI_PRICE_INPUT_PER_1M: z.coerce.number().min(0).default(0.25),
    OPENAI_PRICE_OUTPUT_PER_1M: z.coerce.number().min(0).default(2),

    WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
    META_APP_SECRET: optionalString,
    META_WEBHOOK_VERIFY_TOKEN: optionalString,
    META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),

    BILLING_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    BILLING_LIVE_MODE: bool,
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    let key: Buffer | undefined;
    try {
      key = Buffer.from(v.ENCRYPTION_KEY, "base64");
    } catch {
      key = undefined;
    }
    if (!key || key.length !== 32) issue("ENCRYPTION_KEY", "must be 32 bytes encoded as base64");

    if (v.APP_ENV === "production" && v.AUTH_PROVIDER === "local") {
      issue("AUTH_PROVIDER", "the local auth adapter is for development only; use 'supabase' in production");
    }
    if (v.AUTH_PROVIDER === "supabase" && (!v.NEXT_PUBLIC_SUPABASE_URL || !v.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
      issue("AUTH_PROVIDER", "supabase auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    if (v.STORAGE_PROVIDER === "supabase" && (!v.NEXT_PUBLIC_SUPABASE_URL || !v.SUPABASE_SERVICE_ROLE_KEY)) {
      issue("STORAGE_PROVIDER", "supabase storage requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    if (v.APP_ENV === "production" && v.STORAGE_PROVIDER === "local") {
      issue("STORAGE_PROVIDER", "local disk storage is not durable on serverless hosts; use 'supabase' in production");
    }
    if (v.AI_PROVIDER === "openai" && !v.OPENAI_API_KEY) issue("OPENAI_API_KEY", "required when AI_PROVIDER=openai");
    if (v.WHATSAPP_PROVIDER === "meta" && (!v.META_APP_SECRET || !v.META_WEBHOOK_VERIFY_TOKEN)) {
      issue("WHATSAPP_PROVIDER", "meta provider requires META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN");
    }
    if (v.EMAIL_PROVIDER === "resend" && !v.RESEND_API_KEY) issue("RESEND_API_KEY", "required when EMAIL_PROVIDER=resend");
    if (v.BILLING_PROVIDER === "stripe" && (!v.STRIPE_SECRET_KEY || !v.STRIPE_WEBHOOK_SECRET)) {
      issue("BILLING_PROVIDER", "stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
    }
    // Live charging is opt-in twice: an explicit flag AND a live key.
    if (v.STRIPE_SECRET_KEY?.startsWith("sk_live_") && !v.BILLING_LIVE_MODE) {
      issue("BILLING_LIVE_MODE", "a live Stripe key was provided without BILLING_LIVE_MODE=true");
    }
    if (v.APP_ENV === "production" && !v.CRON_SECRET) issue("CRON_SECRET", "required in production");
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Parsed lazily so builds don't require secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests that mutate process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const isProduction = () => env().APP_ENV === "production";

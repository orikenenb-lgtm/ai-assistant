# Security checklist & threat model

Status of each control as implemented in this repository. "Tested" means an automated
test in `tests/` exercises it. Findings from the internal security review and their
resolution are listed at the end.

## Threat model (summary)

| Asset | Main threats | Primary controls |
|---|---|---|
| Tenant CRM data (contacts, deals, messages, files) | Cross-tenant access, privilege escalation inside a tenant, data exfiltration via AI or API | Server-side RBAC + Postgres RLS (two independent walls), composite tenant FKs, scoped API keys, AI tools run as the user |
| Accounts | Credential stuffing, session theft, account enumeration, MFA bypass | Rate limits, hashed session tokens, httpOnly cookies, uniform responses, TOTP with replay protection |
| Integrations (WhatsApp, Stripe, webhooks) | Forged webhooks, replay, SSRF via user-supplied URLs, token theft | HMAC signature checks (timing-safe), event de-duplication, SSRF guard with DNS pinning, AES-256-GCM at rest |
| Money | Accidental live charges | Mock billing by default; live mode needs `BILLING_LIVE_MODE=true` **and** a live key |
| Platform admin powers | Abuse of super-admin access | Separate guard, 404 for non-admins, read-only time-boxed support mode with mandatory reason, every action and support page view audited |

## Controls

### Authentication & sessions
- [x] Supabase Auth in production; local adapter refused when `APP_ENV=production` (env validation). *Tested*
- [x] Local adapter: scrypt password hashes, session tokens stored as SHA-256, httpOnly + SameSite=Lax + Secure (in production) cookies. *Tested*
- [x] Email verification required before sign-in; reset/verification tokens single-use, hashed, expiring. *Tested*
- [x] No account enumeration on sign-up / reset (same response; "account exists" email instead). *Tested*
- [x] Rate limits: sign-up per IP (configurable, default 10/h), login per account and per IP, reset, resend, MFA attempts. *Tested*
- [x] TOTP MFA (RFC 6238) with replay protection; disabling MFA requires a fresh code. *Tested (E2E)*
- [x] Session list and "sign out other devices".

### Authorization & tenant isolation
- [x] Every server action: zod schema + permission (`tenantAction`), read-only support mode blocks writes. *Tested*
- [x] Services re-check permissions (`assertCan` / `assertCanWrite`) so jobs, API keys and AI tools follow the same matrix. *Tested*
- [x] RLS on every tenant table; `crm_app` role for user requests; browser role limited to SELECT on realtime tables. *Tested (18 RLS isolation tests + per-module isolation tests)*
- [x] Composite foreign keys `(tenant_id, x_id)` prevent cross-tenant references at the database level.
- [x] Last-owner protection, role-assignment rules (managers cannot grant owner). *Tested*
- [x] Platform admin: super-admin flag only, 404 otherwise, audited; support sessions read-only, ≤ 4 h, reason required, page views audited. *Tested*

### Input, output & browser security
- [x] All inputs validated with zod on the server; Drizzle parameterized queries (raw SQL only via tagged templates).
- [x] CSP with per-request nonce, `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (proxy.ts / next.config.ts).
- [x] Server Actions CSRF protection (Origin check by Next.js) and 2 MB body limit.
- [x] CSV exports protected against formula injection; UTF-8 BOM for Excel. *Tested*
- [x] File uploads: size limits, MIME/extension allow-list, content sniffing for images (logos), downloads via authorized routes with `Content-Disposition: attachment` and HMAC-signed short-lived URLs. *Tested*

### Integrations
- [x] WhatsApp webhook: `X-Hub-Signature-256` over the raw body, timing-safe compare, 512 KB limit, persisted before 200, de-duplicated. *Tested*
- [x] Only the official Meta WhatsApp Cloud API; mock provider refused in production. Consent, opt-out keywords and the 24-hour window enforced server-side for users, automations and AI alike. *Tested*
- [x] Stripe webhook signatures with 5-minute tolerance, idempotent processing, live keys refused without explicit live mode. *Tested*
- [x] Outbound webhooks & automation `call_webhook`: HTTPS only, private/loopback/link-local/metadata addresses refused, DNS resolved once and pinned, HMAC-SHA256 signatures with timestamp, retries with auto-disable. *Tested*
- [x] Public API: keys shown once and stored hashed, per-key scopes mapped to the permission matrix, 600 req/min per key, tenant-scoped, audited writes. *Tested*
- [x] Automation webhook trigger: random token stored hashed, rate-limited, 64 KB limit, idempotency key.

### AI
- [x] Untrusted content (messages, lead forms, notes) passed only as delimited data; injection heuristics flag suspicious content in the UI. *Tested*
- [x] Tools are read-only and run with the user's context (RBAC + RLS). *Tested*
- [x] Every write is a proposal requiring human approval, executed as the approver with their permissions. *Tested*
- [x] Per-user and per-tenant rate limits, monthly token quota per plan, feature flag kill-switch, full metering. *Tested*

### Secrets & data protection
- [x] Secrets only server-side; validated env; nothing secret in `NEXT_PUBLIC_*`.
- [x] Third-party tokens encrypted with AES-256-GCM using HKDF-derived sub-keys.
- [x] Log redaction of secrets by key name (pino).
- [x] Audit log for security-relevant actions; exports restricted by role and plan.
- [x] Privacy: contact/organization export, contact erasure, organization deletion with 30-day grace, retention jobs. *Tested*
- [x] Development-only surfaces (`/dev/mailbox`, seed, `db:reset`) refuse to run outside development/test.

## Operational requirements (deployment)

- Deploy behind a proxy that sets `X-Forwarded-For` (Vercel does); client IPs for rate limiting are read from it.
- Keep `ENCRYPTION_KEY`, `CRON_SECRET`, `META_APP_SECRET`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` in the hosting secret store; never in the repository.
- Enable Supabase PITR backups; restrict database network access; rotate secrets on staff changes.
- Promote super admins manually and sparingly (SQL, see `DEPLOYMENT.md`).

## Review findings

_Filled in after the internal security review (see below)._

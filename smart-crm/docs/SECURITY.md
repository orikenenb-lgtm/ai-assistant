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
- [x] Rate limits: sign-up per IP (configurable, default 10/h); login per account+IP (10/15 min), per account (100/15 min) and per IP (50/15 min) so a stranger cannot lock an owner out; password reset, resend, MFA challenge (5/5 min), password change (5/15 min). *Tested*
- [x] Client IP taken from `x-vercel-forwarded-for` or the right-most `X-Forwarded-For` hop (never the client-controlled left-most value). *Tested*
- [x] TOTP MFA (RFC 6238) with replay protection; disabling MFA requires a fresh code; password change requires a completed MFA session (aal2). *Tested (E2E)*
- [x] Supabase password reset requires proof of a recovery link (signed, httpOnly, 15-minute cookie set by `/auth/confirm`), not just a session.
- [x] Post-login redirects (`next=`) only to same-origin paths; control characters and backslashes rejected. *Tested*
- [x] Session list and "sign out other devices".

### Authorization & tenant isolation
- [x] Every server action: zod schema + permission (`tenantAction`), read-only support mode blocks writes. *Tested*
- [x] Services re-check permissions (`assertCan` / `assertCanWrite`) so jobs, API keys and AI tools follow the same matrix. *Tested*
- [x] RLS on every tenant table; `crm_app` role for user requests; browser role limited to SELECT on realtime tables. *Tested (18 RLS isolation tests + per-module isolation tests)*
- [x] Composite foreign keys `(tenant_id, x_id)` prevent cross-tenant references at the database level.
- [x] Last-owner protection, role-assignment rules (managers cannot grant owner). *Tested*
- [x] Platform admin: super-admin flag only, 404 otherwise, audited; MFA (aal2) required outside development/test; support sessions read-only, ≤ 4 h, reason required, page views audited. *Tested*
- [x] Role hierarchy also enforced by the database: managers can only manage and invite agents; a membership's tenant/user never change. *Tested*
- [x] Background jobs are bound to the tenant of the job row: payload tenant must match, handlers verify the loaded record's tenant, user transactions cannot squat scheduler keys. *Tested*
- [x] Suspended or deleted organizations start no automations or outbound webhooks. *Tested*

### Input, output & browser security
- [x] All inputs validated with zod on the server; Drizzle parameterized queries (raw SQL only via tagged templates).
- [x] CSP with per-request nonce, `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (proxy.ts / next.config.ts).
- [x] Server Actions CSRF protection (Origin check by Next.js) and 2 MB body limit.
- [x] CSV exports protected against formula injection; UTF-8 BOM for Excel. *Tested*
- [x] File uploads: size limits, MIME/extension allow-list, content sniffing for images (logos), downloads via authorized routes with `Content-Disposition: attachment` and HMAC-signed short-lived URLs. *Tested*
- [x] Storage keys: every key must be `<tenant uuid>/<area>/…` with plain segments (no `..`, backslashes, empty segments, `%`); browsers can never supply a storage key; keys are not sent to clients. *Tested*
- [x] Company websites normalized to http(s) URLs (no `javascript:`/`data:`). *Tested*

### Integrations
- [x] WhatsApp webhook: `X-Hub-Signature-256` over the raw body, timing-safe compare, 512 KB limit, persisted before 200, de-duplicated. *Tested*
- [x] Only the official Meta WhatsApp Cloud API; mock provider refused in production. Consent, opt-out keywords and the 24-hour window enforced server-side for users, automations and AI alike. *Tested*
- [x] Connecting a number proves the token controls it (listed under the given WABA); inbound events must come from that WABA and an active account. *Tested*
- [x] Stripe webhook signatures with 5-minute tolerance, idempotent processing, live keys refused without explicit live mode. *Tested*
- [x] Outbound webhooks & automation `call_webhook`: HTTPS only, private/loopback/link-local/metadata addresses (incl. IPv4-mapped, NAT64, SIIT, 6to4, Teredo) refused, DNS resolved once and pinned, overall 10 s deadline and 2 KB response cap, retries with auto-disable. Outbound webhooks are HMAC-SHA256 signed with a timestamp. *Tested*
- [x] Public API: keys shown once and stored hashed, per-key scopes mapped to the permission matrix, 600 req/min per key, tenant-scoped, audited writes. *Tested*
- [x] Automation webhook trigger: random token stored hashed, rate-limited, 64 KB limit, idempotency key.

### AI
- [x] Untrusted content (messages, WhatsApp profile names, lead form fields, notes) passed only as delimited data; injection heuristics flag suspicious content in the UI. *Tested*
- [x] Tools are read-only and run with the user's context (RBAC + RLS). *Tested*
- [x] Every write is a proposal requiring human approval, executed as the approver with their permissions. *Tested*
- [x] Per-user and per-tenant rate limits, monthly token quota per plan, feature flag kill-switch, full metering. *Tested*

### Secrets & data protection
- [x] Secrets only server-side; validated env; nothing secret in `NEXT_PUBLIC_*`.
- [x] Third-party tokens encrypted with AES-256-GCM using HKDF-derived sub-keys.
- [x] Log redaction of secrets by key name (pino), including header-cased variants.
- [x] Outgoing email bodies (which contain one-time links) are purged after 7 days.
- [x] Audit log for security-relevant actions; exports restricted by role and plan.
- [x] Privacy: contact/organization export, contact erasure, organization deletion with 30-day grace, retention jobs. *Tested*
- [x] Development-only surfaces (`/dev/mailbox`, seed, `db:reset`) refuse to run outside development/test (and the mailbox never on Vercel); production refuses the `log` email provider and live Stripe keys (`sk_live_`/`rk_live_`) without `BILLING_LIVE_MODE`.
- [x] Organization time zones validated in the app and by a database trigger (an invalid zone once could break scheduled jobs for every tenant). *Tested*

## Operational requirements (deployment)

- Deploy behind a proxy that sets `X-Forwarded-For` (Vercel does); client IPs for rate limiting are read from it.
- Keep `ENCRYPTION_KEY`, `CRON_SECRET`, `META_APP_SECRET`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` in the hosting secret store; never in the repository.
- Enable Supabase PITR backups; restrict database network access; rotate secrets on staff changes.
- Promote super admins manually and sparingly (SQL, see `DEPLOYMENT.md`).

## Internal security review (2026-10-19)

Two independent read-only reviews (attack surface & authentication; multi-tenant
isolation) were run against the merged code base. Every finding below was fixed
in this repository and covered by a regression test
(`tests/integration/security-hardening.test.ts`, `tests/unit/security-helpers.test.ts`)
unless marked otherwise.

| Severity | Finding | Resolution |
|---|---|---|
| High | WhatsApp media: a client-supplied storage key with `../` could read or send another tenant's files | Fixed (media only from the upload route; strict key shape; storage-layer guard; keys hidden from clients) |
| High | Any tenant could register another business's WhatsApp phone-number ID and receive its messages | Fixed (ownership proof on connect; WABA + active-account check on inbound) |
| High (non-prod) | `/dev/mailbox` reachable on staging/preview with the default email provider | Fixed (development/test only, never on Vercel; `log` provider refused in production) † |
| Medium | Privacy erasure/purge/retention did not delete WhatsApp media (wrong JSON key) | Fixed |
| Medium | Role hierarchy (manager → owner) enforced only in the app | Fixed (column grants + trigger + restrictive invitation policies) |
| Medium | Job queue payloads trusted over the job's tenant; scheduler keys could be squatted | Fixed (RLS insert rules, runner and handler tenant checks) |
| Medium | Open redirect via control characters in `next=` | Fixed |
| Medium | One tenant's invalid time zone broke hourly/15-min jobs for all tenants | Fixed (validation + DB trigger + per-workflow isolation + defensive SQL) |
| Medium | Password change possible from an aal1 session; Supabase reset without recovery proof | Fixed † |
| Medium | Spoofable client IP for rate limits; targeted login lockout | Fixed (trusted IP source — tested; account+IP keyed limits and MFA challenge limit †) |
| Low-Med | Super admins without MFA | Fixed outside development/test † |
| Low | Notifications/emails to non-members; automation references to other tenants' users/tags/stages | Fixed |
| Low | Tags editable / AI proposals forgeable by agents at the SQL level | Fixed |
| Low | Suspended tenants kept running automations/webhooks | Fixed |
| Low | Lead/profile names presented to the model as trusted facts | Fixed |
| Low | Webhook POST without an overall deadline; SSRF classifier gaps (SIIT/6to4/Teredo) | Fixed |
| Low | Email bodies with bearer links kept forever; case-sensitive log redaction; `rk_live_` not checked at startup | Fixed † |
| Low | Supabase auth cookies long-lived | Now 30 days, `Secure` in production, `SameSite=Lax` (JS access remains: needed by the Realtime client) † |

† Code fix without a dedicated automated test (needs a live Supabase project, a
production configuration or a full request context); verified by review and by
the existing suites still passing.

### Accepted / residual risks

* **Database role switching.** User requests run as `crm_app` via `SET LOCAL ROLE` on a privileged
  connection. RLS is enforced, but a SQL-injection bug could `RESET ROLE`. All queries are
  parameterized (Drizzle / tagged templates); a dedicated login role and pool for user traffic is
  recommended before scale.
* **Job rows are readable by members of the same tenant** (the enqueue path uses `INSERT … RETURNING`).
  Payloads contain only that tenant's data.
* **`/auth/confirm` acts on GET** (as Supabase's own links do); link scanners may consume one-time
  tokens. An interstitial confirmation page is a planned improvement.
* **Automation `call_webhook` requests are not signed** (they carry an `Idempotency-Key`); use the
  signed outbound webhooks for integrations that need authenticity.
* **AI chat tool output** (CRM records the user may read) is returned to the model without
  delimiters; any write still requires an explicit human approval.
* **Supabase per-IP auth limits** see the server's egress IP; the app's own limits are the effective control.

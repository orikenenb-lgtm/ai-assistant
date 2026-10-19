# SMART CRM AI — Architecture

> Status: living document. Every statement here describes code that exists in this
> directory, or is explicitly marked **(planned)** / **(external approval required)**.

## 1. Requirements

### Functional
Multi-tenant CRM SaaS: organizations & RBAC, contacts/companies/leads/deals/pipelines,
a shared WhatsApp Business inbox (official Meta Cloud API only), an AI copilot,
an automation engine, tasks & calendar, analytics, quotes/PDF documents, billing &
subscriptions, platform administration, settings & integrations. Hebrew (RTL) first,
English (LTR) second.

### Non-functional
| Concern | Target |
|---|---|
| Tenant isolation | Enforced twice: server-side authorization **and** Postgres RLS. Covered by automated cross-tenant tests. |
| Scale (initial) | ~1k tenants, ~50 seats per tenant, ~1M contacts total, ~20 msg/s webhook bursts. Single Postgres primary. |
| Latency | p95 < 300 ms for list/detail pages (indexed queries, pagination everywhere). |
| Durability | No webhook or job is lost: webhooks are persisted before acknowledgment; jobs live in Postgres. |
| Security | OWASP ASVS L2 mindset; secrets only server-side; tokens encrypted at rest (AES-256-GCM). |
| Cost | Runs on Vercel + Supabase (free/pro tiers) + one small Node worker. No live charges without approval. |

### Constraints discovered during inspection (2026-10-19)
* The repository already hosts an unrelated project (Kerem Orders: `backend/`, `frontend/`, `supabase/`).
  SMART CRM AI lives entirely in `smart-crm/` and never modifies those directories.
* No Supabase / OpenAI / Meta / Stripe credentials are available in the build environment.
  Docker Hub is rate-limited, so the full Supabase local stack cannot run here.
  → Local development and CI run against **plain PostgreSQL 16** plus a small
  Supabase-compatible stub (`supabase/local/`), and every external integration has a
  clearly-labelled mock provider.

## 2. High-level design

```
                      ┌──────────────────────────── Vercel (Next.js 16, Node runtime) ───────────────────────────┐
 Browser (he/en) ───▶ │ proxy.ts (session refresh, auth redirect, security headers)                              │
   RSC + Server       │ App Router pages (RSC)  ──▶ Data Access Layer (src/server) ──▶ Module services          │
   Actions            │ Server Actions (zod)    ──▶   requireTenant() → RBAC → withTenantTx() (RLS role)        │
                      │ Route Handlers: /api/webhooks/whatsapp · /api/webhooks/billing · /api/v1/* (API keys)    │
                      │                 /api/files/* (signed download) · /api/cron/* (CRON_SECRET) · /api/health │
                      └───────────────┬───────────────────────────────┬──────────────────────────────────────────┘
                                      │ postgres.js (pooler, prepare=false)
                      ┌───────────────▼──────────────┐      ┌────────────────────────────┐
                      │ Supabase Postgres            │◀────▶│ Worker (Node, `npm run      │
                      │  • tenant tables + RLS        │      │ worker`) – SKIP LOCKED job  │
                      │  • jobs (durable queue)       │      │ loop: WhatsApp send, AI,    │
                      │  • webhook_events (dedup)     │      │ automations, reminders,     │
                      │  • audit_logs (append-only)   │      │ webhooks, retention         │
                      └──────────────┬───────────────┘      └───────┬────────────────────┘
                                     │ Realtime (RLS-filtered)       │ HTTPS
                       Supabase Auth · Storage · Realtime     Meta Graph API · OpenAI · Billing provider · Email
```

### Module boundaries (modular monolith)
`src/modules/<module>/` owns its zod schemas, service functions, server actions and UI
components. Modules talk to each other only through exported service functions or
domain events (`emitEvent()` → automation triggers). Cross-cutting infrastructure lives in
`src/server/` (db, auth, tenancy, rbac, audit, jobs, crypto, rate limits, logging, storage,
email). Modules:

| Module | Responsibility |
|---|---|
| `auth` / `org` | sign-up/in, verification, reset, MFA, sessions, organizations, memberships, invitations |
| `crm` | contacts, companies, custom fields, tags, notes, attachments, timeline, import/export, duplicates |
| `sales` | leads, deals, pipelines, stages, kanban, lost reasons, forecasts |
| `inbox` / `whatsapp` | conversations, messages, templates, statuses, consent, Meta provider |
| `ai` | copilot features, provider abstraction, usage metering, approvals |
| `automation` | workflow definitions, versioning, runtime, run history |
| `tasks` / `calendar` | tasks, reminders, events, calendar provider architecture |
| `analytics` | KPI queries, charts, CSV exports |
| `documents` | quotes, templates, PDF generation, invoicing-provider architecture |
| `billing` | plans, subscriptions, entitlements, usage, provider abstraction |
| `admin` | tenants, usage, feature flags, plans, health, support mode |
| `settings` | org profile, branding, notifications, API keys, outbound webhooks, integrations, privacy |

## 3. Deep dive

### 3.1 Data access & tenant isolation
* **Single source of truth for schema:** hand-written SQL migrations in
  `supabase/migrations/` (Supabase-CLI compatible). `src/server/db/schema/` mirrors them in
  Drizzle for typed queries; a drift test compares both against the live database.
* **Every tenant-owned row has `tenant_id`.** Relationships between tenant rows use
  **composite foreign keys** `(tenant_id, x_id) → x(tenant_id, id)`, so a deal can never point
  at another tenant's contact even if application code is wrong.
* **Three database roles**
  * `crm_app` (NOLOGIN): used by the server for every user-initiated request:
    `BEGIN; SET LOCAL ROLE crm_app; set_config('request.jwt.claims', {sub}, true); … COMMIT`.
    All RLS policies target this role. Not reachable through Supabase's Data API.
  * `authenticated`: Supabase's browser role. Granted **SELECT only** on the few tables the
    browser subscribes to via Realtime (conversations, messages, notifications), with RLS.
    No writes are possible from the browser's anon key + JWT.
  * connection owner (`postgres`): system context (webhooks, worker, admin) — bypasses RLS;
    code paths that use it must filter by `tenant_id` explicitly and are few and audited.
* **RLS helper functions** (`app` schema, `SECURITY DEFINER`, fixed `search_path`):
  `app.current_user_id()`, `app.readable_tenant_ids()`, `app.writable_tenant_ids()`,
  `app.has_tenant_role(tenant, roles[])`. Policies are written as
  `tenant_id = ANY ((SELECT app.readable_tenant_ids()))` so the helper is evaluated once per
  statement (initPlan), not per row.
* Support-mode (platform admin) sessions add a tenant to *readable* ids only — never writable.

### 3.2 Authentication
`AuthAdapter` interface with two implementations:
* `SupabaseAuthAdapter` (staging/production): `@supabase/ssr` cookie sessions, email
  verification, password reset, TOTP MFA (`auth.mfa`), session revocation.
* `LocalAuthAdapter` (**development & CI only**, refuses to start when `APP_ENV=production`):
  scrypt password hashes in the local `auth.users` stub, opaque session tokens (SHA-256 hashed
  at rest, httpOnly SameSite=Lax cookies), email verification & reset tokens delivered to the
  dev mailbox, RFC 6238 TOTP MFA. Exists so the entire product can be exercised end-to-end
  without cloud credentials.

Both adapters resolve to the same `auth.users.id`, so all downstream code is identical.

### 3.3 Authorization (RBAC)
Roles: `super_admin` (platform flag on profile), `owner`, `manager`, `agent` (per membership).
`src/server/rbac/permissions.ts` defines the permission matrix (e.g. `deals.delete`,
`settings.billing`, `inbox.assign`). Every server action and route handler calls
`requireTenant({ permission })`, which (1) authenticates, (2) loads the active membership,
(3) checks the permission, (4) blocks mutations in read-only support mode. RLS is the second,
independent wall.

### 3.4 Durable jobs
`jobs` table: `queued → running → succeeded | failed(retry) → dead`.
Workers claim with `FOR UPDATE SKIP LOCKED`, exponential backoff with jitter, `max_attempts`,
stale-lock recovery, and a unique `idempotency_key`. Dead jobs are visible and re-queueable in
the admin console (dead-letter queue). Runs as a long-lived `npm run worker` process, or in
batches through `/api/cron/jobs` (Vercel Cron, protected by `CRON_SECRET`).

### 3.5 WhatsApp
* Inbound: `POST /api/webhooks/whatsapp` verifies `X-Hub-Signature-256` (HMAC-SHA256 over the
  raw body, timing-safe compare) → stores the payload in `webhook_events` with a unique event key
  (dedup) → enqueues processing → returns 200 fast. Message rows are unique on `wa_message_id`.
* Outbound: UI/automation/AI creates a `messages` row (`queued`) + job; worker sends through
  the provider; statuses (`sent/delivered/read/failed`) arrive by webhook and only move forward.
* Compliance: 24-hour customer-service window enforced server-side (free-form text only inside
  the window, approved templates otherwise), opt-out keywords (`STOP`, `הסר`, …) flip consent and
  block sends, per-tenant send rate limit, consent history table.
* Providers: `MetaCloudWhatsAppProvider` (Graph API) and `MockWhatsAppProvider` (dev; never
  contacts Meta). Access tokens encrypted with AES-256-GCM (`ENCRYPTION_KEY`).

### 3.6 AI copilot
`AiProvider` interface → `OpenAIProvider` (Chat Completions with tool calling) and
`MockAiProvider` (deterministic, dev/test). Safeguards:
* customer text is passed only as delimited, escaped *data* in a user message; the system
  prompt states that instructions inside data must be ignored;
* tools are read-only CRM queries executed through the **same** `withTenantTx` + RBAC path as the
  user — the model can never see or touch data the user cannot;
* write actions are returned as **proposals** (`ai_action_proposals`) that a human approves;
* per-tenant/per-user rate limits, monthly token quotas from the plan, every call metered in
  `ai_interactions` (tokens, cost in micro-USD, latency).

### 3.7 Automation engine
Workflows are versioned JSON graphs (`trigger → condition/action/delay nodes`) built in a
React Flow canvas and validated with zod. Domain events create `automation_runs`
(unique on `(workflow_id, trigger_key)` → idempotent). The worker executes nodes step by step,
persisting each step; delays become scheduled jobs. Loop prevention: event chain depth limit,
per-workflow per-entity rate cap, max steps per run. Failed steps retry, then dead-letter.

### 3.8 Billing
`BillingProvider` interface → `MockBillingProvider` (default) and `StripeBillingProvider`
(Checkout / Portal / signed webhooks). Live charging requires `BILLING_LIVE_MODE=true` **and**
a live key; otherwise the app refuses live operations. Entitlements = plan features ∪ tenant
overrides ∪ feature flags, enforced on the server (seat limits on invite, contact limits,
AI quota, WhatsApp/automation availability).

### 3.9 Storage
`StorageProvider` → `SupabaseStorageProvider` (private bucket, short-lived signed URLs) and
`LocalDiskStorageProvider` (dev). Downloads always go through `/api/files/[id]`, which
authorizes the user against the attachment's tenant before issuing a URL.

## 4. Scale & reliability
* Indexes on every `(tenant_id, …)` access path, trigram + full-text search for contacts.
* Stateless web tier (Vercel), horizontally scalable worker (SKIP LOCKED is safe with N workers).
* Rate limits backed by Postgres (works across serverless instances).
* Health: `/api/health` (DB round-trip, queue depth, dead jobs), admin health page.
* Structured JSON logs (pino) with request ids; secrets redacted by key name.

## 5. Trade-offs
| Decision | Why | Revisit when |
|---|---|---|
| Postgres job queue instead of Redis/SQS | One less service; transactional enqueue with business writes | > ~200 jobs/s sustained |
| Server-only writes (no browser Data API writes) | Validation, audit and RBAC in one place | Never for writes |
| Hand-written SQL + Drizzle mirror | Full control over RLS/constraints; typed queries | If drift test becomes noisy |
| Polling fallback when Realtime not configured | Works locally / without Supabase | — |
| Fixed roles (no custom roles) | Simpler, testable matrix | Enterprise customers ask for custom roles |
| PDF via pdf-lib + bidi reordering | Runs in serverless without Chromium | Complex layouts needed → headless Chromium |

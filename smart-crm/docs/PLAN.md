# SMART CRM AI — Implementation plan

Each phase is "done" only when its acceptance criteria are verified by automated tests
(unit / integration against real Postgres / Playwright E2E) and the results are recorded in
[`PROGRESS.md`](PROGRESS.md). External integrations that need credentials are completed in
code + tests + mock provider, and listed under *Outstanding approvals*.

| # | Phase | Acceptance criteria (summary) |
|---|---|---|
| 1 | Inspection, architecture, plan | ARCHITECTURE.md + PLAN.md exist; environment constraints documented |
| 2 | Scaffolding, DB, auth | `npm run db:reset` builds schema from migrations on PG16; sign-up → verify email → login → logout → reset password → MFA work E2E with the local adapter; Supabase adapter compiles and is unit-tested; design system, he/en, RTL/LTR, dark/light |
| 3 | Tenancy & RBAC | create org, invite (token, expiry, seat limit), accept, change role, remove member; permission matrix unit-tested; **cross-tenant RLS tests** for every tenant table; audit log rows for all admin actions |
| 4 | Customer & sales CRM | CRUD for contacts/companies/leads/deals with zod validation; custom fields; tags; notes; attachments (authorized download); timeline; full-text search + filters; CSV import (validation report) / export; duplicate detection & merge; pipelines/stages editor; drag-and-drop kanban (keyboard accessible); lost reasons; forecast |
| 5 | WhatsApp inbox | webhook verify + signature + dedup tests; inbound creates contact/conversation/message; outbound via queue with retries; statuses monotonic; 24h window & opt-out enforced; templates; assignment, notes, handoff; mock provider labelled |
| 6 | AI copilot | summarize, draft reply, intent, lead classification, next actions, task generation, CRM search, trend analysis; tenant-scoped tools; proposals need approval; usage+cost metering; rate limits & quotas; prompt-injection tests |
| 7 | Automation & worker | builder UI saves valid versioned graphs; triggers/conditions/actions/delays execute via jobs; idempotency, retries, dead-letter, pause/resume, loop prevention, execution limits — all tested |
| 8 | Tasks, calendar, analytics, documents | tasks with reminders; month/week/agenda calendar; KPI dashboards with date filters and CSV export; quotes with line items, totals, statuses, Hebrew PDF |
| 9 | Billing & admin & settings | plans, trials, seats, usage metering, entitlements enforced; mock + Stripe-shaped provider with signed webhooks; admin console (tenants, usage, flags, plans, health, DLQ, support mode with reason + expiry + audit); API keys + public REST API v1; outbound webhooks with HMAC + SSRF guard; privacy export/deletion |
| 10 | Hardening & tests | security review checklist completed; lint/typecheck/unit/integration/E2E green in CI |
| 11 | Staging & readiness | deployment configs (Vercel + worker), setup guide, API docs, security checklist, production-readiness report, known limitations, outstanding approvals |

## Outstanding approvals (cannot be done from this environment)
* Supabase project credentials (URL, anon key, service DB URL) for staging/production.
* OpenAI API key (`OPENAI_API_KEY`).
* Meta WhatsApp Business: app id/secret, phone number id, WABA id, permanent token, webhook verification.
* Billing provider account (Stripe) — live charging requires explicit approval.
* Email provider (Resend) API key and verified sending domain.
* Vercel project + worker host; production deployment approval.

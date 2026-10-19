# Production readiness report

_Last updated: 2026-10-19. This report only states what was actually built and
verified in this repository. Nothing here has been deployed or connected to a real
external account._

## Verdict

**Feature-complete and verified locally and in CI; not yet production-ready**
until the external accounts below are connected, the staging checklist passes
on real infrastructure, and the owner approves go-live. No code changes are known
to be required for that; the remaining work is configuration, verification against
real providers, and approvals.

## What exists

| Module | State | Notes |
|---|---|---|
| Auth, organizations, invitations, roles, MFA, sessions, audit | ✅ Built & tested | Supabase adapter (production) + local adapter (dev/CI only). Supabase path not exercised against a live project. |
| Contacts & companies (custom fields, tags, notes, files, timeline, CSV import/export, duplicates/merge) | ✅ | |
| Sales: leads, deals, multiple pipelines, Kanban (mouse + keyboard), lost reasons, forecasts, stage history | ✅ | |
| WhatsApp shared inbox (official Cloud API) | ✅ with **mock provider**; Meta provider coded & unit-tested against a fake Graph API | Requires Meta app, verified number, approved templates |
| AI Copilot (chat with read-only tools, summaries, reply drafts, intent, lead scoring, next actions, trends, proposals with human approval, metering) | ✅ with **mock provider**; OpenAI provider coded | Requires `OPENAI_API_KEY` |
| Automation engine (visual builder, 22 event triggers, schedules, webhook & manual triggers, 13 actions, delays, retries, DLQ, loop protection, run history) | ✅ | |
| Tasks, reminders, calendar (month/week/day/agenda), notification preferences | ✅ | Google Calendar sync coded, disabled behind `calendar.sync` (needs OAuth app) |
| Analytics & dashboards (role-aware KPIs, 5 report tabs, CSV) | ✅ | |
| Quotes & documents (Hebrew PDF, gapless numbering, public link, accept/reject) | ✅ | Never presented as tax invoices; invoicing providers mapped but inactive |
| Billing & subscriptions (plans, trials, seats, usage, entitlements, portal) | ✅ with **mock provider**; Stripe provider coded & tested against a fake API | Live charging impossible without `BILLING_LIVE_MODE=true` **and** a live key |
| Platform admin (tenants, overrides, plans, flags, failed jobs, audit, support mode) | ✅ | |
| Settings, API keys, REST API v1 (contacts, companies, deals, tasks), outbound webhooks, privacy, audit log | ✅ | OpenAPI 3.1 in `docs/openapi.json` |
| Hebrew RTL + English LTR, light/dark, responsive, command palette, global search | ✅ | |

## Verification performed

| Check | Result |
|---|---|
| TypeScript strict (`next typegen && tsc`) | clean |
| ESLint (incl. React Compiler rules) | clean |
| Unit + integration tests (real PostgreSQL 16 with RLS) | **442 passed** across 39 files |
| End-to-end (Playwright, production build, Hebrew UI) | **22 scenarios passed** (listed below) |
| `next build` | passes |
| Schema drift (`db:check` against a freshly migrated database) | no drift |
| GitHub Actions (`smart-crm.yml`: lint, typecheck, unit, integration, drift, build, E2E) | green on the PR branch |
| Internal security review (2 independent reviewers) | all findings fixed or documented — see `SECURITY.md` |
| Visual/functional QA sweep (every route, he/en, light/dark, desktop/mobile, owner/agent) | majors fixed (hydration, localized 404/error pages, mobile overflow, command palette, quote line errors, rate-limit message); remaining polish listed below |

E2E scenarios: registration → email verification → login → organization → dashboard;
password reset; MFA enrolment and sign-in; Hebrew validation and English switch;
contacts CRUD, notes, files, tags, consent, CSV import and merge; sales (company →
lead → conversion → Kanban drag & keyboard → won → pipeline settings); WhatsApp
inbox (mock number → inbound → reply → ticks → assignment → note → close; opt-out);
quotes (items → totals → PDF → send → customer accepts via public link); tasks,
calendar and notification preferences; analytics and CSV export; automations
(build → publish → event → action → run history); developer settings (API key →
REST call → revoke; webhooks with SSRF guard); team invitations and roles; billing
plan change (mock) and platform admin with support mode; localized 404 pages,
command palette and hydration checks on chart pages.

## Outstanding approvals & credentials (owner action required)

| # | Item | Needed for | Status |
|---|---|---|---|
| 1 | Supabase project (URL, anon key, service-role key, DB password), Auth URL config, MFA enabled | Production auth, DB, storage, realtime | **Missing** |
| 2 | Vercel project (root `smart-crm`), env vars, paid plan for per-minute cron *or* a worker host | Hosting | **Missing** |
| 3 | Worker host (Railway/Fly/Render/VM) running `npm run worker` | Background jobs at volume | **Missing** |
| 4 | Meta: business verification, WhatsApp app, phone number, System User token, app secret, webhook subscription, template approval | Live WhatsApp | **Missing** — no live message was ever sent |
| 5 | OpenAI API key and spending limit | Live AI | **Missing** — only the labelled mock ran |
| 6 | Stripe account (test mode), products/prices, webhook secret | Billing | **Missing**; going live needs **explicit approval** |
| 7 | Resend account + verified sending domain | Real email | **Missing** |
| 8 | Google Cloud OAuth app (+ verification for calendar scopes) | Calendar sync | Optional, **missing** |
| 9 | Invoicing provider (Morning / iCount) credentials + legal review | Tax invoices | Optional, **missing** |
| 10 | First super admin promotion and MFA enrolment | Platform admin | After deploy |
| 11 | **Production deployment go-ahead** | Go-live | **Requires owner approval** |

## Known limitations

* Supabase Auth, Supabase Storage and Realtime code paths were not exercised against a
  live Supabase project (local/CI use plain Postgres + a stub; realtime falls back to polling).
* Meta, OpenAI, Stripe, Resend and Google integrations were verified only against mocks/fakes.
* Money in analytics/forecasts is summed in the organization's currency only (no FX).
* Deal board has no live multi-user sync (refresh to see others' moves).
* WhatsApp: a crash between Meta accepting a message and the database update could
  re-send it on retry (at-least-once).
* Quotes: logo shown in the PDF but not on the public web page; staff opening the
  customer link counts as a view.
* Calendar: only Saturday shaded as weekend; DST-day hour rows follow wall-clock time.
* Automation `call_webhook` requests are not signed (use outbound webhooks for signed delivery).
* Residual security risks are listed in `SECURITY.md`.
* UI polish still open from the QA sweep: access-denied states differ between sections
  (redirect vs. alert vs. empty state); some settings pages use their own header style and
  width; English mode aligns Hebrew record titles to the right; mobile dashboards stack all
  KPI cards before content; the Kanban board has no horizontal-scroll hint; calendar month
  view on phones truncates event chips; mock-AI fallback text shows raw stage/source values.

## Go-live checklist

1. Complete items 1–7 above (and 8–9 if needed).
2. Run migrations against the Supabase project; promote the super admin; enable MFA.
3. Deploy a Vercel **Preview**, run the smoke checklist in `DEPLOYMENT.md` with real providers
   (Stripe in test mode, an internal WhatsApp test number).
4. Configure log drain + uptime monitor on `/api/health`, and queue alerts.
5. Owner approval → promote to production.
6. Only after a separate explicit approval: `BILLING_LIVE_MODE=true` with live Stripe keys.

# Local setup

Everything below runs without any cloud account. External services (auth, AI,
WhatsApp, billing, email, storage, calendar) default to **clearly labelled mock
providers**; the UI shows a "demo/mock" badge wherever one is active.

## Requirements

* Node.js 22 and npm
* PostgreSQL 16 (plain Postgres — the Supabase-specific bits are stubbed by `supabase/local/00_supabase_stub.sql`)
* Chromium for E2E tests (CI downloads it; locally set `PLAYWRIGHT_CHROMIUM_PATH` if it is not at `/opt/pw-browsers/chromium`)

## First run

```bash
cd smart-crm
npm ci
cp .env.example .env.local
# fill ENCRYPTION_KEY (32 random bytes, base64) and CRON_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

createdb smart_crm_dev                # or: psql -c 'create database smart_crm_dev'
npm run db:reset                      # local only: stub + all migrations
npm run db:seed                       # demo tenant "כרם טויס (דמו)"
npm run dev                           # http://localhost:3000
npm run worker                        # second terminal: background jobs
```

Demo users (password `Demo!Password1`): `owner@demo.test` (also platform super
admin), `manager@demo.test`, `agent@demo.test`.

Emails are not sent in development: open **/dev/mailbox** to read verification,
reset and invitation emails (the page only exists when `APP_ENV` is development or test).

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` | Durable job worker (WhatsApp sends, automations, reminders, webhooks, billing lifecycle, retention). Without it, jobs only run when `/api/cron/jobs` is called. |
| `npm run db:migrate` | Apply pending migrations (tracked in `supabase_migrations.schema_migrations`) |
| `npm run db:reset` | Drop & recreate the local schema (refuses to run when `APP_ENV=production`) |
| `npm run db:status` | Applied / pending migrations |
| `npm run db:generate` / `db:check` | Regenerate / verify `src/server/db/schema.ts` from the live database |
| `npm run db:seed` | Demo data |
| `npm run i18n:index` | Regenerate the message-catalog index after adding a namespace |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint (includes the React Compiler rules) |
| `npm run test:unit` | Unit tests |
| `npm run test:integration` | Integration tests against `TEST_DATABASE_URL` (default `smart_crm_test`, reset automatically) |
| `npm run test:e2e` | Playwright against a production build on port 3100 using `E2E_DATABASE_URL` (default `smart_crm_e2e`, reset automatically). Run `npx next build` first. |

## Trying the integrations locally

* **WhatsApp**: Settings → WhatsApp → connect a *mock* number. The inbox then shows a
  developer simulator that posts real, HMAC-signed webhook payloads to the app.
* **AI**: `AI_PROVIDER=mock` returns deterministic answers (labelled). Set
  `AI_PROVIDER=openai` + `OPENAI_API_KEY` to use OpenAI.
* **Billing**: the mock provider applies plan changes instantly and never moves money.
* **Automations**: build a workflow under /automations, publish, then trigger it
  (e.g. create a contact). With the worker running, runs appear within seconds.
* **Public API**: Settings → API keys (owner), then see `docs/API.md`.

## Project layout

See `docs/ARCHITECTURE.md` (design, data model, security model) and
`docs/CONVENTIONS.md` (how modules, data access, UI and tests are written).

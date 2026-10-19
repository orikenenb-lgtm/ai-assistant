# Engineering conventions

These rules keep modules consistent. The contacts module (`src/modules/crm/contacts`) is the
reference implementation — copy its shape.

## Layout
```
src/modules/<module>/
  schemas.ts        zod input schemas (shared by actions, API and tests)
  service.ts        business logic: (ctx: ServiceCtx, input) => result   — no cookies/headers
  actions.ts        "use server" wrappers: tenantAction(input, {schema, permission}, handler)
  jobs.ts           registerJobHandler / registerSchedule / subscribeToEvents (imported by src/server/jobs/registry.ts)
  components/       client/server UI components
src/app/(app)/<route>/page.tsx   server components: requireTenant() → service calls → render
messages/{he,en}/<namespace>.json  one namespace per module; run `npm run i18n:index` after adding a file
```

## Data access
* Every user-initiated operation runs through `ctx.run(tx => …)`; for users that is `withUserTx`
  (RLS enforced as `crm_app`). Always also filter by `ctx.tenantId` explicitly.
* Authorize at the top of each service function: `assertCan(ctx, perm)` for reads,
  `assertCanWrite(ctx, perm)` for writes (also blocks read-only/support mode).
* Write an audit row (`audit(tx, ctx, …)`) for every mutation, in the same transaction.
* Emit domain events (`emitEvent`) for state changes automations may react to.
* Enqueue side effects with `enqueueJob(tx, …)` in the same transaction (transactional outbox).
* Never trust ids from the client: load the row scoped to the tenant before mutating; related ids
  are verified (composite FKs enforce it in the DB as well).
* `postgres.js` + JSON: pass JSON as `${JSON.stringify(v)}::text::jsonb` in raw SQL (plain `::jsonb`
  double-encodes). Pass dates to raw SQL as ISO strings. Prefer Drizzle builders (they handle both).
* Schema changes = a new file in `supabase/migrations/` + `npm run db:generate` (never edit
  `src/server/db/schema.ts` by hand). New tenant tables: composite FKs + `app.enable_tenant_rls`.

## UI
* Hebrew first, RTL-safe: logical properties (`ms-`, `pe-`, `start-`, `text-start`), `dir="ltr"` on
  phone numbers/emails/URLs, `dir="auto"` on user text. Icons that point flip with `rtl:-scale-x-100`.
* Only design tokens (`bg-surface`, `text-muted-foreground`, `bg-primary-soft` …) — no raw colors
  except user-provided data colors (tags, stages).
* Every list: empty state, no-results state, pagination; every form: inline field errors from
  `useServerAction().fieldErrors`, pending state on the submit button, toast on success.
* Interactive elements are real buttons/links with accessible names; dialogs via `components/ui/dialog`.
* No `setState` synchronously inside effects (React compiler lint): use `useRemoteData`,
  `useDebouncedSearch`, lazy `useState` initializers or event handlers.

## Tests
* Integration tests hit real Postgres (`tests/integration`, one schema per run).
* Every module: service tests for happy path, validation, permission denial, cross-tenant denial.
* E2E (`tests/e2e`) for the main user journey of the module. Hebrew UI strings as selectors.

## Commits
Hebrew commit messages (repository convention), English code and comments.

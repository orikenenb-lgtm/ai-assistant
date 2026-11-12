# Ori Travel AI — web app (`apps/web`)

Hebrew-first, right-to-left SPA for the private family travel platform.
React 19 · TypeScript 6.0 · Vite 8 · Tailwind CSS v4 · TanStack Query v5 · React Router 8 · Zod 4 · Radix primitives · lucide-react.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (default `127.0.0.1:5173`), proxies `/api` → `http://127.0.0.1:8000` |
| `npm run build` | `tsc -b && vite build` → `dist/` (served by FastAPI when `ORI_SERVE_WEB=true`) |
| `npm run typecheck` | Type-check app + tooling configs |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run test` | Vitest + Testing Library (jsdom), no network |
| `npm run e2e` | Playwright (`e2e/*.spec.ts`), needs a running API + web app |

Env vars for dev: `VITE_API_TARGET` (API origin, e.g. `http://127.0.0.1:8010`), `VITE_PORT`.
The proxy keeps the browser `Host` header (`changeOrigin: false`) because the API's
Origin check compares `Origin` with `Host` for unsafe requests — do not change it.

Playwright is pinned to **1.63.0** to match the pre-installed Chromium in
`/opt/pw-browsers`. Never run `playwright install`. All dependencies (including
`leaflet`/`react-leaflet` for the optional map) are already installed — do not run
`npm install` concurrently with other agents; ask the lead if a new package is essential.

## Folder structure

```
src/
  main.tsx, App.tsx (providers), router.tsx (route table, lazy pages)
  styles/index.css            design tokens (@theme) + base styles
  lib/
    api.ts                    fetch wrapper, ApiError, CSRF, session-expiry events
    queryClient.ts            TanStack defaults (no retry on 4xx)
    format.ts                 money/date/relative-time formatting (he-IL)
    labels.ts                 Hebrew labels for enums (categories, roles)
    schemas/                  Zod mirrors of backend contracts (offers, search, auth, providers, …)
  components/
    ui/                       design system (import from '@/components/ui')
    layout/                   AppShell, sidebar/drawer, top bar, tab bar, auth layout, error boundary
    QueryState.tsx            standard loading/error/empty/unavailable wrapper for queries
    PlaceholderPage.tsx       honest "built in the next stage" page
  features/<area>/            api.ts, hooks.ts, components/…  (auth, notifications, providers, search, trips, dashboard)
  pages/<area>/<Name>Page.tsx one file per route, default export
  test/                       setup, render/fetch helpers, contract fixtures
e2e/                          Playwright specs (QA agent)
```

## Conventions (all frontend agents)

**Pages & routing**
- One page per file in `src/pages/<area>/<Name>Page.tsx` with a **default export**. The router
  lazy-loads it; implement a screen by replacing the placeholder file — no router edits needed.
- Every page renders exactly one `<PageHeader>` (the page `<h1>`; also sets `document.title`).
- Results deep-link convention: `/search/<flights|hotels|cars|activities>?search_id=<id>` (the dashboard links there).

**Data access**
- Only use `api.get/post/put/patch/delete` from `@/lib/api` (never raw `fetch`). Paths start with `/api/`.
- Each feature's `api.ts` exports a query-key factory (`tripKeys`, `searchKeys`, …) and fetchers that
  **always pass a Zod `schema`**. Shared contracts live in `src/lib/schemas/`; feature-only shapes may live in the feature.
- `hooks.ts` wraps TanStack Query; mutations invalidate by key. 4xx are never retried.
- Render query states with `<QueryState>` (404 ⇒ "not available yet", other errors ⇒ `ErrorState` with retry + request id).
- Errors are `ApiError {status, code, message (Hebrew), details, requestId}`. Show `err.message`;
  use `err.fieldErrors()` for 422 field errors. A 401 `UNAUTHORIZED` automatically signs the user out.
- CSRF is automatic for unsafe methods. Step-up (`/api/auth/reauth`) failures are ordinary errors.

**Honesty & money**
- Every offer shows `<ModeBadge mode={offer.source.mode} />` (DEMO/LIVE/CACHED); provider runs/health show their status badge.
  Never fabricate prices, availability or confirmations.
- Money is a decimal **string**: render with `<MoneyText value={money} />`; never `parseFloat` for arithmetic.
  Show estimated/excluded components separately (`estimated` prop, `price.components[].status`).
- Dates: `<DateText value timeZone="source">` for supplier local times (flight/hotel/car — keeps the ISO offset's wall clock),
  `timeZone="viewer"` (default) for system timestamps; `<DateRange>`; `<FreshnessText value={source.fetched_at}>`.

**RTL, design, a11y**
- User-facing text is Hebrew; code/identifiers English.
- Use logical utilities only: `ms-/me-/ps-/pe-`, `start-/end-`, `text-start/end`, `rounded-s/e`. Never `ml/mr/pl/pr/left/right`.
  Directional icons: arrows meaning "forward" point left (`ArrowLeft`, `ChevronLeft`); add `ltr:rotate-180`/`rtl:rotate-180` when needed.
  Latin-only content (emails, IATA codes, URLs, env vars) gets `dir="ltr"`.
- Colors: the default Tailwind palette is removed. Use semantic tokens (`bg-canvas`, `bg-surface`, `bg-surface-sunken`,
  `text-fg`, `text-fg-muted`, `text-fg-subtle`, `border-line`, `text-accent`) or the palette scales
  (`ink`, `sand`, `sea`, `sun`, `moss`, `harbor`, `amber`, `coral`). All text pairs used are WCAG AA.
- Forms: wrap controls in `<Field label hint error>` (wires `id`, `aria-describedby`, `aria-invalid`); use `noValidate` + Hebrew Zod messages.
- `IconButton` requires a Hebrew `label`. Tooltips are supplementary only. Radix wrappers (`Dialog`, `ConfirmDialog`, `Drawer`,
  `Tabs`, `DropdownMenu`, `Tooltip`, `Switch`) already handle focus, keyboard and RTL.
- Animations respect `prefers-reduced-motion` globally.

**Permissions** — `canEdit(user)`, `canBook(user)`, `isOwner(user)` from `@/features/auth` hide UI;
`<RequireRole roles={['owner']}>` guards screens. The server always enforces; never rely on the UI.

**Offers UI** (agent F2) goes in `src/features/offers/` — use `CanonicalOfferSchema`, `isOfferKind(offer, 'flight')`,
`DEFAULT_RANKING_WEIGHTS`, `MoneyText`, `ModeBadge`, `DateText timeZone="source"`.

**Tests** — colocate `*.test.ts(x)`. Use `createFetchMock`, `renderRoutes`, `jsonResponse`, `errorResponse` from `@/test/utils`.
`src/test/fixtures/contracts.json` is generated from the backend Pydantic models; regenerate it when contracts change.

## Design system (`@/components/ui`)

Button / ButtonLink (`primary|accent|secondary|ghost|danger|link`, `sm|md|lg`, `loading`), IconButton, Input, Textarea,
NativeSelect, Checkbox, Switch, Field, Card / CardHeader / CardFooter, Badge, ModeBadge, Callout, Dialog, ConfirmDialog,
Drawer, Tabs, DropdownMenu, Tooltip, Skeleton / SkeletonText, EmptyState, ErrorState, Toast (`useToast`), Spinner,
PageHeader, Stat, DataTable, Pagination, MoneyText, DateText / DateRange, FreshnessText, Kbd, VisuallyHidden.

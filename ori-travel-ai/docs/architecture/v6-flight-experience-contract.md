# V6 Contract — Fare calendar, featured deal, flight results, route map (internal, English)

> Owner: Project Director. Binding for V6 agents. Design reference: the owner's screen recording
> (described in the V6 prompt — not available as a file): light minimal search form, dense
> colour-coded fare calendar (orange / yellow / blue cells), table-like results, emphasised
> orange featured fare card, route map. We build an ORIGINAL Hebrew RTL product inspired by that
> workflow — no copied branding, assets or layouts; the price in the clip is illustrative only.

## 1. Fare calendar API (backend owner: BE-CAL)

`POST /api/search/flight/calendar` (any signed-in member; rate limit 10 / 10 min per user)

Request (validated with the same rules as `FlightSearchParams` where applicable):
```json
{
  "origin": "TLV", "destination": "FCO",
  "depart_from": "2026-12-01", "depart_to": "2026-12-31",
  "trip_nights": [5],            // [] or omitted ⇒ one-way; up to 7 values, each 1..30
  "adults": 2, "children_ages": [7], "cabin": "economy",
  "max_stops": null, "checked_bags": 0, "currency": "ILS"
}
```
Limits: `depart_to - depart_from` ≤ 41 days (42 depart dates); total cells
(`depart dates × max(1, len(trip_nights))`) ≤ 150 ⇒ else 422 with a Hebrew message.

Response:
```json
{
  "origin": "TLV", "destination": "FCO", "currency": "ILS",
  "depart_dates": ["2026-12-01", "..."], "trip_nights": [5],          // [null] for one-way
  "cells": [{
    "depart_date": "2026-12-01", "return_date": "2026-12-06", "nights": 5,
    "status": "priced" | "no_offers" | "not_searched" | "error",
    "min_total": {"amount": "2421.73", "currency": "ILS"} | null,
    "per_person": {"amount": "807.24", "currency": "ILS"} | null,
    "travelers": 3,
    "tier": "best" | "low" | "mid" | "high" | null,   // relative to priced cells, same currency
    "mode": "DEMO" | "CACHED" | "LIVE" | null,
    "provider_id": "demo_skyline" | null, "provider_name": "…" | null,
    "offers_count": 7, "fetched_at": "…Z" | null,
    "message": "…" | null                               // Hebrew, for error / not_searched
  }],
  "stats": {"min": Money|null, "max": Money|null, "median": Money|null,
            "priced": 20, "no_offers": 6, "not_searched": 5, "error": 0},
  "sources": [{"provider_id", "provider_name", "mode", "status", "message"}],
  "legend_note": "Hebrew legend explanation",
  "coverage_note": "Hebrew honest statement (DEMO, cached-only live data, no full market coverage)",
  "has_demo": true, "generated_at": "…Z"
}
```

Rules (non-negotiable):
* **No invented prices.** A cell is `priced` only when an actual adapter quote (DEMO fixture or
  cached LIVE/CACHED offer) exists for exactly that depart/return/pax/cabin.
* `no_offers` = searched, providers answered, zero offers. `not_searched` = nothing was asked for that
  cell (e.g. only cached live data exists elsewhere). `error` = provider failed for that cell.
* **DEMO adapters** are queried per cell in-process (deterministic, no network, no cost).
  DEMO flight data must include realistic **no-service days** for some routes (documented,
  deterministic) so `no_offers` really occurs.
* **LIVE adapters are NEVER called per cell** (cost/rate limits). Only offers already stored from
  earlier real searches (within `search_cache_ttl_minutes`) may fill cells, labelled `CACHED`.
  `sources[]` must state "live providers not queried for the calendar" when applicable.
* Calendar cells are **not persisted** as offers. Clicking a cell in the UI runs the normal
  `POST /api/search/flight` for that depart/return date.
* `tier`: tertiles of priced cells in the same currency; the minimum price cell(s) get `best`.

## 2. Search response highlights (backend owner: BE-CAL)

Add to `SearchResponse` (additive): 
```json
"highlights": {"currency": "ILS", "cheapest_offer_id": "…", "fastest_offer_id": "…" | null,
               "best_score_offer_id": "…", "comparable_count": 12,
               "note": "הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (מטבע זהה) — לא בהכרח בכל השוק"}
```
Computed over the offers returned by this search after filters, only among offers in the dominant
currency (most offers). `null` when no offers.

## 3. Geo data (backend owner: BE-CAL)

`GET /api/geo/airports` (any signed-in member, cacheable) →
`[{code, city_code, name_he, name_en, city_he, city_en, country_code, lat, lon, timezone}]` from the
existing dataset (`providers/data/geo.py`). Used by the airport combobox and the route map.
No external geocoding.

## 4. Flights UI (frontend owner: FE-FLIGHT)

* **Compact search header** (light, one row on desktop, stacked on mobile): origin, destination
  (combobox from `/api/geo/airports`), dates + flexibility, travelers with child ages, cabin,
  bags, budget, Search. Existing validation stays.
* **Fare calendar** (centrepiece): month grid (depart dates, fixed nights) and a date matrix
  (depart × nights, up to 7×7) toggle. Cells show the price text (MoneyText compact) or a clear
  text/icon state: `—` "לא נבדק" (not_searched), `∅` "אין טיסות" (no_offers), `!` (error). Colours
  from tokens `bg-heat-best/low/mid/high/none/unknown`; **colour is never the only signal**
  (tier label in aria-label + a small marker for `best`). Legend with all states + DEMO/CACHED badge.
  Keyboard: arrow-key grid navigation (roving tabindex), Enter selects. Mobile: horizontal swipe
  with scroll-snap + "previous/next week" buttons as the keyboard-accessible alternative.
  Selecting a cell runs the normal search for those dates and updates the results.
* **Featured deal panel** (tangerine `deal` tokens): from `highlights.cheapest_offer_id`: large total
  price, "סה״כ ל-N נוסעים" vs "לנוסע", airline, route, dates, baggage, supplier, freshness, mode badge,
  "בדיקת ההצעה" button (opens details) and "הכנת הזמנה" (existing StartBookingButton). Text must say
  "הזול ביותר מבין ההצעות שנמצאו" — never "the cheapest flight".
* **Results**: list ⇄ table toggle (table on desktop; cards on mobile < 768px). Table columns:
  supplier/airline, itinerary (times, stops, duration), total, per person, baggage, cancellation,
  last checked, mode. Filters: stops, max price, **checked bag included**, departure window, cabin;
  sort. Every number traceable to the offer.
* **Route map**: SVG map (no tiles, no external requests) with a simplified world basemap from an
  npm package bundled at build time (Natural Earth derived, e.g. `world-atlas` + `topojson-client`,
  ISC/public-domain licenses — record versions/licenses), great-circle path for the selected offer's
  slices including stops. Only when coordinates exist; otherwise hidden.
* Keep existing `data-testid`s (`search-results`, `result-count`, …) and Hebrew labels stable where
  possible; add new ones: `fare-calendar`, `fare-cell` (with `data-status`, `data-date`),
  `featured-deal`, `results-table`, `route-map`.

## 5. Design system refresh (owner: UX-DS)

Light, clean, fast-comparison look (not a dark luxury dashboard): light sidebar/top bar, white
surfaces, neutral typography, tangerine accent reserved for best deals, sky for low prices.
Optional dark mode via `prefers-color-scheme` + manual toggle (stored in localStorage, wrapped in
try/catch). Touch targets ≥ 44px, WCAG AA, reduced motion. Tokens added by the Director in
`src/styles/index.css` (tangerine, sky, `deal*`, `heat-*`) are the contract — tune values only with
contrast checks and document them in `docs/release/design-system.md`.

# Provider API notes (engineer-facing)

Research date: 2026-11-12. Method: web search only; direct fetch of official docs was blocked in the research sandbox. Tags: **[official]** = official page surfaced in search snippet, **[3rd]** = third-party source, **[prior]** = author's prior knowledge, NOT verified this session, **[unverified]** = could not confirm. Re-verify everything marked [prior]/[unverified]/[3rd] against official docs before coding.

## 0. Go/no-go summary

| Provider | Usable for private non-company app? |
|---|---|
| Duffel | Test mode yes. Live needs account activation with person/business info; individual eligibility unverified |
| Amadeus Self-Service | NO. Decommissioned 2026-07-17 |
| Booking.com Demand API | NO without Managed Affiliate Partner contract |
| Expedia Rapid | NO without commercial partner agreement |
| Viator Partner API | Probably, Basic affiliate access (search + affiliate links) |
| Cars | No accessible API; deep links only |
| ECB / BoI FX, OSM | Yes |

## 1. Duffel (flights)

- Docs: https://duffel.com/docs/api/v2/offer-requests , https://duffel.com/docs/api/v2/offers , https://duffel.com/docs/api/orders , https://duffel.com/docs/api/overview/test-mode , https://duffel.com/docs/api/overview/errors
- Base URL (test and live are the same host; mode is determined by the token): `https://api.duffel.com` [official, via search]
- Headers: `Authorization: Bearer <token>`, `Duffel-Version: v2` [official]. Also `Accept: application/json`, `Content-Type: application/json`, `Accept-Encoding: gzip` [prior].
- Test token prefix `duffel_test_`; created in dashboard under "Developer test mode" [official https://duffel.com/docs/api/overview/test-mode]. Live token requires account activation [official https://duffel.com/guides/getting-started]; activation collects business info for regulatory/financial-partner reasons [official https://help.duffel.com/hc/en-gb/articles/360019685959]. Individual eligibility: [unverified]. Ask Duffel.
- Test airline: "Duffel Airways" (fake schedules/prices) [official test-mode page].
- Flow [official docs list the endpoints]:
  1. `POST /air/offer_requests` (add `?return_offers=false` to avoid giant inline response, then `GET /air/offers?offer_request_id=...&limit=..&sort=total_amount` [prior]); list endpoints use `limit` default 50, max 200 [official]
  2. `GET /air/offers/{id}` to refresh before checkout; list endpoint does NOT return complete/up-to-date info [official https://duffel.com/docs/api/offers , https://help.duffel.com/hc/en-gb/articles/360021052540]
  3. `POST /air/orders`
- Minimal search body [prior shape; verify]:

```json
{
  "data": {
    "slices": [
      {"origin": "TLV", "destination": "ATH", "departure_date": "2027-03-10"},
      {"origin": "ATH", "destination": "TLV", "departure_date": "2027-03-17"}
    ],
    "passengers": [{"type": "adult"}, {"type": "adult"}, {"type": "child"}],
    "cabin_class": "economy"
  }
}
```

- Fields to map [prior; verify against schema]: offer `id`, `total_amount`, `total_currency`, `tax_amount`, `base_amount`, `expires_at` [official: `expires_at` exists], `owner` (airline), `slices[].segments[]` (origin/destination, `departing_at`, `arriving_at`, marketing/operating carrier, flight number, aircraft), `passengers[].baggages`, `conditions.refund_before_departure`, `conditions.change_before_departure`, `payment_requirements` (`requires_instant_payment`, `price_guarantee_expires_at`).
- Expiry: no official duration found. A third-party MCP doc says 15 to 30 min [3rd]. Always trust `expires_at`. Expired offer: new offer request required [official https://help.duffel.com/hc/en-gb/articles/360021052820].
- Price re-check: Get single offer ("refresh") [official]; a price-update action exists on offers ("Update an offer") [official, via search]. Paying with stale price yields `price_changed` error; re-fetch [official https://duffel.com/docs/guides/getting-an-accurate-price-before-booking].
- Errors/rate limit: `rate_limit_exceeded`; retry after `ratelimit-reset` header [official https://duffel.com/docs/api/overview/errors]. Numeric limit: [unverified]. Implement exponential backoff.
- Pricing [3rd, confirm at https://duffel.com/pricing]: ~$3 per confirmed order, ~$2 per paid ancillary, ~1% managed content, excess-search fee above 1500:1 search:book ratio (~$0.005/search). Ratio itself official [https://help.duffel.com/hc/en-gb/articles/4412912264466]. **Implication: zero bookings + many searches = fees. Rate-limit and cache our own searches, never auto-poll.**
- Payments: Payment Intents may be closed to new customers [official, search snippet]; Duffel balance top-up by bank transfer is the alternative [official getting-started].
- Hold/pay later exists: https://duffel.com/docs/guides/holding-orders-and-paying-later [official, availability per airline unverified].
- Duffel Links/hosted checkout: [unverified].
- Env: `ORI_DUFFEL_ACCESS_TOKEN`.
- Unusable if: Live activation refused for individuals. Fallback: search-only display + outbound link to airline.

## 2. Amadeus Self-Service: DO NOT IMPLEMENT

- Self-service portion of Amadeus for Developers decommissioned; registrations paused from ~Feb/Mar 2026; API keys disabled and portal closed 2026-07-17 [3rd, citing Feb 2026 customer letter: https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers ; also https://traveltrade.today/gds-systems/amadeus-sa/amadeus-closes-self-service-apis-portal-for-developers/]. Official Amadeus statement page exists (https://amadeus.com/en/industry-messaging/statement-regarding-amadeus-for-developers-portal) but was not readable here; exact date therefore [3rd].
- Enterprise portal continues; contract/sales required; terms and pricing unclear as of Sept 2026 [3rd https://skift.com/2026/09/03/amadeus-brings-travel-tech-into-claude/].
- GitHub org amadeus4dev archived 2026-07-17 [3rd]. Old test host reportedly has no DNS as of 2026-11-01 [3rd https://medium.com/@apihiver/amadeus-closed-its-free-api-portal-here-is-what-you-can-actually-use-instead-cda56b4396c5].
- Previously (now moot) [prior]: OAuth2 client_credentials at `/v1/security/oauth2/token`, hosts `test.api.amadeus.com` / `api.amadeus.com`, Flight Offers Search `/v2/shopping/flight-offers`. Do not build.
- Remove `ORI_AMADEUS_CLIENT_ID/SECRET` from the plan.

## 3. Booking.com Demand API

- Docs: https://developers.booking.com/demand/docs/getting-started/prerequisites , https://developers.booking.com/demand/docs/development-guide/authentication , https://developers.booking.com/demand/docs/open-api/3.1/demand-api
- Access: Managed Affiliate Partner registration, Partner Centre access via Account Manager after contract, then API key + affiliate ID [official prerequisites page]. No self-serve [3rd https://vorplabs.com/agent-tools/booking-demand-api].
- Hosts: prod `https://demandapi.booking.com/3.1/` [official, via search]; sandbox `https://demandapi-sandbox.booking.com/3.1` [official]. No sandbox for cars [official cars migration guide]. v3.2 exists with breaking changes; some 3.2-Beta endpoints pilot-only [official].
- Headers: `Authorization: Bearer <token>`, `X-Affiliate-Id: <id>` [official]. HTTPS only.
- Endpoints [official]: `POST /accommodations/search` (example body starts with numeric `city` id), accommodations bulk availability, `POST /cars/search`, `/cars/depots`, `/cars/details`, `/cars/suppliers`, `POST /attractions/search` (3.2). Full request/response schema: not read. Use https://developers.booking.com/_spec/demand/docs/open-api/3.2/demand-api.json
- Not all cars on the website are available via API [official].
- Caching/display terms: [unverified], contract-bound.
- Env: `ORI_BOOKING_DEMAND_API_KEY`, `ORI_BOOKING_DEMAND_AFFILIATE_ID`.
- Unusable: requires signed partner agreement.

## 4. Expedia Group Rapid

- Docs: https://developers.expediagroup.com/docs/products/rapid/setup/getting-started , https://developers.expediagroup.com/rapid/lodging/reference/signature-authentication , cars beta https://developers.expediagroup.com/rapid/cars
- Access: must become approved partner; commercial agreement; dev keys restricted until site review [official + 3rd].
- Hosts: test `https://test.ean.com`, prod `https://api.ean.com`; dev key rejected on prod (403) [official getting-started via search].
- Auth: signature = unsalted SHA-512 hex of `apiKey + sharedSecret + unixTimestampSeconds`; timestamp within ~5 min of Expedia clock [official signature page, 5 min from 3rd]. Header form `Authorization: EAN APIKey=<key>,Signature=<sig>,timestamp=<ts>` [prior]. Also required: `Customer-Ip`, `Test` header for test booking scenarios [prior].
- Endpoints (shopping `GET /v3/properties/availability`, price check via link in response, `POST /v3/itineraries`) [prior, verify].
- Content/caching terms: [unverified].
- Env: `ORI_EXPEDIA_RAPID_API_KEY`, `ORI_EXPEDIA_RAPID_SHARED_SECRET`.
- Unusable: partner agreement.

## 5. Viator Partner API

- Docs: https://docs.viator.com/partner-api/ , https://docs.viator.com/partner-api/technical/ , https://partnerresources.viator.com/travel-commerce/affiliate/ , https://partnerresources.viator.com/travel-commerce/affiliate/basic-access/golden-path/
- Access tiers: Basic, Full, Full+Booking, Merchant. Basic cannot call `/availability/check`; booking/payment endpoints need Full+Booking/Merchant [official docs via search]. Sign-up and API access cost nothing [official]. Whether Basic is instant or via account manager: conflicting [3rd vs official] so [unverified].
- Hosts: `https://api.viator.com/partner` ; sandbox `https://api.sandbox.viator.com/partner` [official via search].
- Header: `exp-api-key: <key>` [official]. Also `Accept: application/json;version=2.0` and `Accept-Language` [prior].
- Search: `POST /products/search` [official golden-path] , body shape [prior]:

```json
{
  "filtering": {"destination": "<destId>"},
  "sorting": {"sort": "DEFAULT"},
  "pagination": {"start": 1, "count": 20},
  "currency": "ILS"
}
```

- Map: product code, title, `pricing.summary.fromPrice`, currency, reviews, duration, images, `productUrl` (affiliate-tracked) [prior].
- Attribution: bookings credited within 30 days via cookie on redirect through affiliate URLs [official]. Commission % and URL parameters: [unverified].
- Env: `ORI_VIATOR_API_KEY`.
- Doc pages showed ~1,679-day age metadata, so endpoint matrix may be stale [3rd search note].

## 6. Cars

- Booking.com Demand API cars and Expedia Rapid Car (beta): partner-gated, see sections 3, 4.
- Rentalcars XML credentials not valid for Demand API [official].
- CarTrawler / Discover Cars affiliate-API access for small devs: [unverified].
- Recommendation: no adapter; outbound deep links or manual entry.

## 7. Attractions alternatives

- GetYourGuide: Basic needs ~100k monthly visits or 50k app downloads; own tech team; default 130 calls/min; do not scrape/cache [official https://partner.getyourguide.support/hc/en-us/articles/13981133907613 ; https://github.com/getyourguide/partner-api-spec/wiki/Getting-started]. Not eligible.
- Tiqets: https://www.tiqets.com/en/partner-program/ , https://www.tiqets.com/en/partner-program/api-program/ , ToS https://portals.tiqets.com/distributorapi/terms-of-service . No visitor minimum stated; API free; launch review 2 weeks to months; ToS limits to serving end customers [official/3rd]. Auth/hosts: [unverified].
- Klook: open spec for suppliers https://klook.gitbook.io/ ; affiliate via networks (Travelpayouts etc.); small-dev API: [unverified].

## 8. FX

- ECB: reference rates ~16:00 CET each working day (not TARGET holidays), ~30 currencies incl. ILS, informational only, average rates, not for transactions [official https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html]. Daily file `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` [prior]; SDMX `https://data-api.ecb.europa.eu/service/data/EXR/D.ILS.EUR.SP00.A?lastNObservations=5&format=jsondata` [prior]. Terms/licence: [unverified]. Store `rate`, `source`, `rate_date`, `fetched_at`. Base is EUR, so USD->ILS is a cross rate.
- Bank of Israel: representative rate is indicative, no legal binding, business days only [official https://boi.org.il/en/economic-roles/financial-markets/]. JSON `https://boi.org.il/PublicApi/GetExchangeRates` [3rd]; SDMX at `edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/...` [official PDF https://www.boi.org.il/media/upqgqpuv/extracting-representative-exchange-rates-from-the-new-series-database.pdf]; sources conflict on `.gov.il` vs `.org.il` and paths [3rd]. Terms: [unverified]. Probe both before coding; wrap behind adapter with fallback to ECB.

## 9. Maps

- OSM tile policy https://operations.osmfoundation.org/policies/tiles/ : applies to tile.openstreetmap.org; heavy use not allowed, blocking possible; Referer required [3rd/official partial]; own caching proxy discouraged. Attribution "© OpenStreetMap contributors" [prior]. User-Agent requirement: [unverified], set an identifying UA anyway. Keep usage light; make the tile URL configurable.

## 10. Cross-cutting engineering rules

- One adapter interface; each adapter returns `{ source, fetched_at, expires_at?, currency, total, taxes?, deep_link? }`; label partial coverage.
- Never scrape, never bypass captcha/ToS.
- Secrets only server-side env vars (`ORI_*`), never in client or git.
- Back off on 429/`rate_limit_exceeded`; honor `ratelimit-reset`.
- Do not cache offers beyond `expires_at`; show indicative prices until re-check.

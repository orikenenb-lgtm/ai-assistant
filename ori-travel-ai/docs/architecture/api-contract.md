# API Contract & Team Rules (internal, English)

> Owner: Project Director (01). This is the single source of truth for cross-team
> contracts. Agents implement against it. Changes require a note in
> `docs/agents/decisions.md`.

## 1. Conventions

* Base path `/api`. JSON only (`Content-Type: application/json` is enforced for bodies).
* **Auth**: httpOnly session cookie `ori_session` + CSRF. Every authenticated
  POST/PUT/PATCH/DELETE must send header `X-CSRF-Token: <csrf_token>` (returned by
  `/api/auth/login`, `/api/auth/me`; also in the readable cookie `ori_csrf`).
  Enforced automatically by `app.core.deps.current_user`.
* **Roles**: `owner` > `adult` > `viewer`.
  * `require_owner` — family administration, provider config, server settings, audit.
  * `require_editor` (owner|adult) — create/modify family content (trips, members, alerts).
  * `require_booking_adult` — owner|adult **and** `legal_adult_attested`.
  * `current_user` — any signed-in member (read access, own shortlist, search).
* **Errors**: `{"error": {"code", "message" (Hebrew), "details", "request_id"}}` via
  `app.core.errors.*Error` classes. Never leak stack traces, raw provider payloads or secrets.
* **Money**: `{"amount": "123.45", "currency": "ILS"}` (Decimal as string). DB stores
  integer minor units (`app.core.money.to_minor/from_minor`). Never use float for money.
* **Timestamps**: ISO-8601 UTC with offset in API; DB uses `UTCDateTime` (aware).
* **Data mode badges**: every external datum carries `DEMO | LIVE | CACHED`;
  provider status uses `OK | DEGRADED | FAILED | NOT_CONFIGURED | DISABLED`.
  UI shows "NOT CONNECTED" (לא מחובר) for NOT_CONFIGURED.
* **Pagination**: `?page=1&page_size=20` (max 100) → `{items, total, page, page_size}` (`app.schemas.common.Page`).
* **Audit**: security-relevant mutations call `app.core.audit.record_audit(...)` in the same transaction.
* **User-facing strings are Hebrew.** Code, identifiers, logs: English.

## 2. Shared contracts (already implemented, Wave 0)

| Contract | File |
|---|---|
| Settings/env | `apps/api/app/core/config.py` (`get_settings()`) |
| DB/session/base | `apps/api/app/core/db.py` (`get_db`, `Base`, `UTCDateTime`, `utcnow`) |
| ORM models (all tables) | `apps/api/app/models/*.py` |
| Auth deps & roles | `apps/api/app/core/deps.py` |
| Errors | `apps/api/app/core/errors.py` |
| Money | `apps/api/app/core/money.py` |
| Field encryption | `apps/api/app/core/crypto.py` (`encrypt_str/decrypt_str/mask`) |
| Redaction | `apps/api/app/core/redaction.py` |
| Rate limiting | `apps/api/app/core/ratelimit.py` (`limiter.check(key, limit, window)`) |
| Family settings store | `apps/api/app/core/app_settings.py` (`get_setting/set_setting`, `DEFAULTS`) |
| Canonical offer | `apps/api/app/schemas/offers.py` (`CanonicalOffer`, details per category) |
| Search params/response | `apps/api/app/schemas/search.py` |
| Provider adapter interface | `apps/api/app/modules/providers/base.py` |
| Test fixtures | `apps/api/tests/conftest.py` (`client`, `db`, `make_user`, `auth_client`, `login`) |

**Model changes**: additive columns/tables only, inside your own module's model file,
and list them in your report. Never rename/remove existing columns. Alembic
migrations are generated once by the Director after integration — do NOT create
migration files.

## 3. Endpoints

### 3.1 Auth (Wave 0 — DONE, core)
| Method | Path | Body → Response |
|---|---|---|
| POST | /api/auth/login | `{email,password}` → `SessionOut {user, csrf_token}` |
| POST | /api/auth/logout | → `{ok}` |
| GET | /api/auth/me | → `SessionOut` |
| POST | /api/auth/change-password | `{current_password,new_password}` |
| POST | /api/auth/reauth | `{password}` (step-up, 10 min window; `ctx.recently_reauthenticated`) |
| GET | /api/auth/invitations/{token} | → `{email,display_name,role,expires_at}` |
| POST | /api/auth/invitations/accept | `{token,password}` → `SessionOut` |

`UserOut = {id,email,display_name,role,is_active,legal_adult_attested,can_book,last_login_at,created_at}`

### 3.2 Family, travelers, notifications, audit, settings — owner: **B1**
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/family/members | any | `[{id,display_name,relation,age_group,is_minor,has_traveler_profile,user:{id,email,role,is_active}\|null}]` |
| POST | /api/family/members | editor | `{display_name,relation?,age_group:"adult"\|"child"\|"infant",is_minor}` |
| PATCH | /api/family/members/{id} | editor | partial |
| DELETE | /api/family/members/{id} | owner | deletes person + traveler profile (data deletion); cannot delete a member linked to an active owner |
| GET | /api/family/users | owner | users list |
| PATCH | /api/family/users/{id} | owner | `{role?,is_active?,legal_adult_attested?}`; never leave zero active owners; cannot change own role/deactivate self; deactivation revokes sessions |
| GET | /api/family/invitations | owner | `[{id,email,display_name,role,status:"pending"\|"accepted"\|"expired"\|"revoked",created_at,expires_at}]` |
| POST | /api/family/invitations | owner | `{email,display_name,role,legal_adult_attested,family_member_id?}` → `{invitation, invite_path:"/invite/<token>"}` (token shown once; adult/owner roles require `legal_adult_attested=true`) |
| DELETE | /api/family/invitations/{id} | owner | revoke |
| GET | /api/travelers | any | list, **masked** (no document numbers) |
| GET | /api/travelers/{member_id} | any | owner/adult: decrypted names/DOB + masked passport; viewer: masked |
| PUT | /api/travelers/{member_id} | editor | upsert `{legal_first_name,legal_last_name,date_of_birth,passport_number?,passport_expiry?,nationality?,gender?,seat_preference?,meal_preference?,kosher_required,accessibility_needs[],frequent_flyer?,notes?}`; 503 `ENCRYPTION_UNAVAILABLE` without key |
| DELETE | /api/travelers/{member_id} | editor | delete profile data |
| POST | /api/travelers/{member_id}/passport/reveal | editor + recent reauth | → `{passport_number}`; audited |
| GET | /api/notifications | any | `Page[{id,kind,title,body,link,read_at,created_at}]`, `?unread_only=true` |
| GET | /api/notifications/unread-count | any | `{count}` |
| POST | /api/notifications/{id}/read, /api/notifications/read-all | any | own only |
| GET | /api/audit | owner | `Page[AuditEventOut]`, filters `action`, `actor_user_id` |
| GET | /api/settings | any | `{ranking_weights, scheduler:{enabled,allowed_by_server}, map, display, retention, ai:{provider,configured,model,paid_allowed}, booking:{live_execution:false}, encryption_available, live_providers_enabled}` |
| PUT | /api/settings/ranking-weights | editor | `{cost,convenience,flexibility,quality}` ints summing to 100 |
| PUT | /api/settings/scheduler | owner | `{enabled}` (effective only if `ORI_SCHEDULER_ALLOWED=true`) |
| PUT | /api/settings/map | owner | `{enabled}` |
| PUT | /api/settings/display | editor | `{currency}` |
| PUT | /api/settings/retention | owner | `{search_days (7-365), audit_days (30-1825)}` |
| POST | /api/settings/retention/run | owner | purge old unreferenced search data → counts |

Service contract (used by B3/B4): `app/modules/notifications/service.py`
```python
def notify(db, user_id: str, kind: str, title: str, body: str | None = None, link: str | None = None) -> Notification
def notify_roles(db, roles: tuple[str, ...], kind, title, body=None, link=None) -> int
```
`link` must be a relative in-app path starting with `/` (validated).
Also `app/seed.py::seed_demo(db) -> str` (demo family members + sample traveler preferences, **no users, no document numbers**).

### 3.3 Providers, search, offers, comparison, FX — owner: **B2**
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/providers | any | `[ProviderStatusOut]`: capabilities + `status` + `enabled` + `configured` + `last_health` + `requires_credentials` (names only) + `setup_doc` |
| POST | /api/providers/{id}/health-check | editor | → `ProviderHealth` (rate limited) |
| PUT | /api/providers/{id} | owner | `{enabled, settings?}` (non-secret only) |
| GET | /api/providers/diagnostics | editor | per provider: runs, success rate, avg latency, last error, last run |
| POST | /api/search/{category} | any | body = category params (`app.schemas.search`) → `SearchResponse`; rate limited per user |
| GET | /api/search/{search_id} | any | `?weights=cost:40,convenience:25,flexibility:20,quality:15` re-rank → `SearchResponse` |
| GET | /api/search/history | any | `Page[{search_id,category,params,status,result_count,created_at,origin}]` (own searches) |
| GET | /api/offers/{offer_id} | any | → `CanonicalOffer` |
| POST | /api/comparisons | any | `{offer_ids:[2..10], weights?}` → `{groups:[{category,currency,offers:[CanonicalOffer+score]}], weights, notes[]}` |
| GET | /api/fx/rates | any | `{mode:"DEMO"\|"LIVE", source, as_of, base, rates}` (DEMO table clearly labeled; never used silently) |

Service contract (used by B3 alerts, B4 booking, B5 AI):
```python
# app/modules/search/service.py
def run_search(db, user_id: str | None, params: SearchParams, origin: str = "manual") -> SearchResponse
def get_offer(db, offer_id: str) -> CanonicalOffer          # raises NotFoundError
def get_offer_row(db, offer_id: str) -> Offer
# app/modules/providers/registry.py
def get_adapter(provider_id: str) -> ProviderAdapter          # raises NotFoundError
def all_adapters() -> list[ProviderAdapter]
# app/modules/comparison/scoring.py
def score_offers(offers: list[CanonicalOffer], weights: dict[str,int]) -> list[CanonicalOffer]  # deterministic
```
DEMO providers: at least **two per category** (so dedupe + cross-provider comparison
are exercised), deterministic from params (same input → same output), fictional
supplier brand names (e.g. "דמו-אייר"), real geography (airports/cities), every offer
`source.mode="DEMO"` and `source.note` = Hebrew disclaimer. DEMO adapters implement
`revalidate()` (deterministic, mostly unchanged) and `booking_options()`
(`simulation_available=True`, no external link).

### 3.4 Trips, saved offers, price tracking — owner: **B3**
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/trips | any | summaries |
| POST | /api/trips | editor | `{title,destination?,start_date?,end_date?,timezone?,budget:{amount,currency}?,notes?,traveler_ids[]}` |
| GET | /api/trips/{id} | any | detail incl. `items`, `days[{date,item_ids}]`, `travelers`, `budget` |
| PATCH/DELETE | /api/trips/{id} | editor | |
| POST | /api/trips/{id}/items | editor | manual item |
| POST | /api/trips/{id}/items/from-offer | editor | `{offer_id}` → item w/ offer snapshot, known cost, times |
| PATCH/DELETE | /api/trips/{id}/items/{item_id} | editor | |
| POST | /api/trips/{id}/items/reorder | editor | `{item_ids}` |
| GET | /api/trips/{id}/budget | any | known/estimated/excluded per currency, remaining (same currency only), per kind, warnings |
| GET | /api/trips/{id}/export.ics | any | `text/calendar` RFC 5545 |
| GET | /api/trips/{id}/export.pdf | any | Hebrew PDF (reportlab + python-bidi + bundled DejaVuSans) |
| GET/POST | /api/saved-offers | any | own shortlist; POST `{offer_id,note?,trip_id?}` |
| PATCH/DELETE | /api/saved-offers/{id} | any (own) | |
| GET/POST | /api/alerts | any / editor | POST `{name,category,search_params,target_price?:Money,check_interval_minutes}` |
| PATCH/DELETE | /api/alerts/{id} | editor (own; owner any) | |
| POST | /api/alerts/{id}/check | editor | manual check (cooldown) → `{status,best_offer,triggered,snapshot}` |
| GET | /api/alerts/{id}/snapshots | any | history |

Scheduler: `app/modules/price_tracking/scheduler.py` `maybe_start()/stop()` — starts only if
`ORI_SCHEDULER_ALLOWED=true` AND app setting `scheduler.enabled`; conservative quotas.

### 3.5 Booking preparation — owner: **B4** (live execution OFF)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | /api/bookings | booking adult | `{offer_id, traveler_member_ids[], trip_id?, simulation_scenario?}` → `BookingOut` |
| GET | /api/bookings | any | `Page[BookingSummary]` |
| GET | /api/bookings/{id} | any | `BookingOut` incl. `can:{...}` flags, `terms_summary[]`, `terms_hash`, history |
| PATCH | /api/bookings/{id}/travelers | booking adult | material change → approval invalidated |
| POST | /api/bookings/{id}/revalidate | booking adult | |
| POST | /api/bookings/{id}/approve | booking adult | `{terms_hash, password, confirm:true}` |
| POST | /api/bookings/{id}/submit | booking adult | `{idempotency_key}` — simulation only |
| POST | /api/bookings/{id}/reconcile | booking adult | for UNKNOWN |
| POST | /api/bookings/{id}/cancel | booking adult | pre-submit states |
| POST | /api/bookings/{id}/record-confirmation | booking adult | hosted checkout: `{supplier_reference,notes?}` |
| GET | /api/bookings/{id}/checkout-link | booking adult | allowlisted provider URL, only when APPROVED; audited |

### 3.6 AI — owner: **B5**
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /api/ai/status | any | `{provider,available,model,paid,label,message}` |
| POST | /api/ai/chat | any | `{message, history:[{role,content}] (≤20), context?:{trip_id?}}` → `{reply:{text,mode:"model"\|"fallback",cards:[CanonicalOffer],search_ids[],clarifying_question?,warnings[],grounding:{ok,removed_claims}},tool_calls:[{name,status}]}` |
| POST | /api/ai/parse | any | `{text}` → `{category?, params?, missing_fields[], clarifying_question?}` (works without a model) |
| POST | /api/ai/plan-trip | any | `{destination,start_date,end_date,interests[],adults,children_ages[]}` → day-by-day suggestions grounded in activity search results |

The AI can NEVER call booking/payment functions. Supplier content is untrusted data.

Implemented additions (B5, see decisions ד-013): `/api/ai/parse` also returns `understood`, `assumptions[]`,
`errors[]`; `/api/ai/plan-trip` returns `{destination, destination_code, start_date, end_date, days:[{date, weekday,
label, items:[{type:"activity"|"free", time_slot, time_slot_label, title, offer_id, start_time, duration_minutes,
reasons[], card}]}], intro, intro_mode:"model"|"template", search_id, interests, warnings, grounding}`;
`tool_calls[].status ∈ {ok, error, rejected, skipped}`. Rate limits: chat 20/10min, parse 60/10min, plan 10/10min.

## 4. Team rules for every agent

1. Work **only inside your file scope** (listed in your brief). If you believe a file
   outside your scope must change, do not edit it — describe the change in your report.
2. **No git commands that modify state** (no commit/add/checkout/stash/reset). The Director commits.
3. **No new dependencies** unless essential; if you add one, pin it, say why in the report.
   Never install paid services or call paid/live APIs. No network calls in tests.
4. Tests are mandatory for your module (pytest for API: `apps/api/tests/test_<module>*.py`).
   Run: `cd ori-travel-ai/apps/api && .venv/bin/python -m pytest tests -p no:warnings -q`
   and `.venv/bin/ruff check app tests`. Report real results; never claim success without output.
5. Never fabricate prices, availability, reviews or booking confirmations outside clearly
   labeled DEMO fixtures. Never weaken auth, CSRF, validation, or booking safeguards.
6. Hebrew for all user-facing messages; English for code/comments.
7. Final report: files created/changed, endpoints implemented, tests run + results,
   known gaps, any requested cross-scope changes.

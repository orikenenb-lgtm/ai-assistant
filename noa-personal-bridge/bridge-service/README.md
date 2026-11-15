# bridge-service — NOA Personal Bridge backend

A small, isolated FastAPI service. The Android app sends it the latest burst of WhatsApp messages
from one conversation and gets back an AI-drafted reply. **It never sends messages, never stores
message content, and never logs it.** Sending only ever happens on the phone after in-app approval.

The HTTP contract is [`../API_CONTRACT.md`](../API_CONTRACT.md); the AI boundary is
`bridge_service/ai/base.py`.

## Run locally

```bash
cd noa-personal-bridge/bridge-service
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q                        # tests: no network, fake engine

export BRIDGE_ENABLED=true BRIDGE_ENGINE=stub        # stub = deterministic, offline
.venv/bin/python -m bridge_service.admin init-db
.venv/bin/python -m bridge_service.main              # http://127.0.0.1:8787
# or: .venv/bin/uvicorn bridge_service.main:app --host 127.0.0.1 --port 8787 --no-access-log

.venv/bin/python -m bridge_service.admin create-pairing-code   # 8-char code, 10 min, single use
.venv/bin/python -m bridge_service.admin list-devices          # never shows tokens
.venv/bin/python -m bridge_service.admin revoke-device dev_…
.venv/bin/python -m bridge_service.admin purge                 # drop devices revoked > 30 days ago
.venv/bin/python -m bridge_service.admin export-persona --out data/persona.txt   # see below
```

### `noa_persona`: use the persona FILE mode (recommended default)

NOA's `ENGINE_API_KEY` is a single global key that also authorizes `/agents/{id}/chat` (tools:
WhatsApp, documents, call transfer) and `/calls`. Don't leave it on the bridge host:

```bash
# once, from a trusted shell that has the NOA key (one POST to the read-only /prompt endpoint,
# same allowlist / no-redirect protections as the engine; file written with 0600):
BRIDGE_NOA_ENGINE_URL=https://noa.example BRIDGE_NOA_AGENT_ID=noa BRIDGE_NOA_ENGINE_API_KEY=… \
  .venv/bin/python -m bridge_service.admin export-persona --out data/persona.txt

# then run the bridge WITHOUT the NOA key:
export BRIDGE_ENGINE=noa_persona BRIDGE_PERSONA_FILE=data/persona.txt
unset BRIDGE_NOA_ENGINE_API_KEY
```

With `BRIDGE_PERSONA_FILE` set the engine never contacts NOA (no HTTP client, no key needed), reads
the UTF-8 file (max 20 KB; `[למלא…` placeholder lines dropped) and re-reads it when its mtime
changes — re-run `export-persona` whenever NOA's agent config changes. Live fetching
(`BRIDGE_NOA_ENGINE_URL` + `BRIDGE_NOA_ENGINE_API_KEY` without a persona file) still works but keeps
the unscoped key on the host; use it only on a hardened host.

Docker (local only): see the header of `Dockerfile`. Expose it to the phone only through HTTPS
(a reverse proxy / tunnel you control); the app refuses plain HTTP outside debug builds.

## Configuration

Every variable is listed with a safe default in [`.env.example`](.env.example) (prefix `BRIDGE_`).
The service does not read `.env` files by itself. Key ones:

| variable | default | purpose |
|---|---|---|
| `BRIDGE_ENABLED` | `false` | master switch; false → `/v1/pair` and `/v1/drafts` return 503 |
| `BRIDGE_KILL_SWITCH_FILE` | unset | if this file exists, behaves as disabled (no restart) |
| `BRIDGE_ENGINE` | `stub` | `stub` \| `anthropic` \| `noa_persona` (built by `ai/factory.py`) |
| `BRIDGE_ENGINE_TIMEOUT_SECONDS` | `25` | hard cap per draft → 502 `engine_error` |
| `BRIDGE_RATE_LIMIT_PER_MINUTE` / `_PER_DAY` | `30` / `300` | per device |
| `BRIDGE_PERSONA_FILE` | unset | `noa_persona` only: persona file (recommended; no NOA request, no NOA key) |
| `BRIDGE_PAIRING_ATTEMPTS_PER_HOUR` | `10` | per client IP |
| `BRIDGE_PAIRING_FAILURES_PER_HOUR_GLOBAL` | `20` | failed pairings across all IPs per rolling hour; then every pairing → 429 |
| `BRIDGE_PAIRING_PEPPER` | unset | secret (≥ 16 chars) for HMAC of pairing codes; unset → random `pepper.key` next to the DB |
| `BRIDGE_NONCE_QUOTA_PER_DEVICE` | `200` | live nonces per device (≈ requests per 10 min); beyond → 429 for that device |
| `BRIDGE_AUTH_FAILURES_PER_10_MINUTES` | `60` | failed authentications per client IP; beyond → 429 without a DB lookup |
| `BRIDGE_TRUST_PROXY_HEADERS` | `false` | use last `X-Forwarded-For` hop as client IP — **only** behind a proxy that overwrites the header (see below) |
| `BRIDGE_DEBUG_DOCS` | `false` | expose `/docs` + `/openapi.json` |

## Security model

- **Pairing:** operator runs `create-pairing-code`; codes are 8 chars from Crockford base32 without
  `0/O/1/I` (30 symbols), valid 10 min, single use, stored as **HMAC-SHA256 keyed with a server
  pepper** (`BRIDGE_PAIRING_PEPPER`, or a random 32-byte `pepper.key` created at first start next to
  the DB file with 0600 — never inside the DB), so a leaked DB alone cannot be brute-forced back to
  an unused code. *Upgrade note:* codes created before this change no longer match — just create a
  new one (devices already paired are unaffected). Back up `pepper.key` together with the DB if
  you restore pending codes (losing it only invalidates unused codes). Invalid, expired and used
  codes get the *same* 400 response. Pairing is limited to 10 attempts/hour per client IP **and**
  globally: after 20 failed attempts in a rolling hour across all IPs, every pairing attempt
  (even with a valid code) gets 429 until the oldest failure is an hour old.
- **`BRIDGE_TRUST_PROXY_HEADERS`:** enable it only when the service listens on loopback and is
  reachable solely through a reverse proxy you control that **overwrites** `X-Forwarded-For` with
  the real peer address (e.g. Caddy/nginx `proxy_set_header X-Forwarded-For $remote_addr`). If the
  proxy appends to a client-supplied header, or the port is also reachable directly, a forged
  header defeats every per-IP limit (pairing, failed authentication). The global pairing cap still
  holds in that case.
- **Device token:** `secrets.token_urlsafe(32)`, returned once, stored only as sha256; compared with
  `hmac.compare_digest`. Revoked or unknown → 401. `POST /v1/devices/revoke` works even while disabled.
- **Replay protection:** `X-Bridge-Timestamp` (epoch ms) within ±300 s and `X-Bridge-Nonce` (UUID)
  accepted once per device → otherwise 409 `replay`. Missing/malformed headers are also 409.
  The token is checked first, so unauthenticated callers cannot burn a device's nonces or fill the
  nonce store. Each device may hold at most `BRIDGE_NONCE_QUOTA_PER_DEVICE` (200) live nonces →
  beyond that 429 for that device only. Failed authentications are limited per client IP (60 per
  10 min → 429, checked before the DB is queried).
- **Limits:** body ≤ 64 KB (checked while streaming, before parsing); messages 1..20, text ≤ 2000,
  total ≤ 8000, sender name ≤ 80 → 413 `too_large`; other schema errors → 422 `invalid_request`.
  Error bodies are fixed Hebrew strings and never echo submitted values.
- **Rate limit:** 30/min and 300/day per device → 429 with `Retry-After`. Idempotent replays served
  from cache do not count.
- **Idempotency:** same `(device, request_id)` within 10 min returns the cached response without
  calling the engine — but only for an identical body: the cache also keeps a SHA-256 of the
  canonical request, and the same `request_id` with a different body → 422 `invalid_request`
  ("מזהה הבקשה כבר שימש לבקשה אחרת"). Concurrent duplicates are serialised by a per-key
  `asyncio.Lock`, so the engine runs once. Failures (502/429) are not cached.
- **Engine isolation:** the engine call is wrapped in `asyncio.wait_for` and a concurrency
  semaphore; timeouts, `EngineError` and any engine exception become 502 `engine_error`
  (retryable). Engines are tool-free (see `ai/base.py`); no endpoint triggers any side effect.
- **HTTP hardening:** `nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP
  `default-src 'none'`, no CORS, `/docs` and `/openapi.json` off by default, no `Server` header.

## What is stored

| where | what | why |
|---|---|---|
| SQLite (`BRIDGE_DB_PATH`, WAL, file 0600) | `devices(id, token_sha256, name, created_at, last_seen_at, revoked_at)`, `pairing_codes(code_sha256, created_at, expires_at, used_at)`, `schema_migrations` | authentication only |
| `pepper.key` (next to the DB, 0600) | random pepper for pairing-code HMAC (only if `BRIDGE_PAIRING_PEPPER` is unset) | L-11 |
| memory | nonces (≤ 10 min), idempotency cache incl. drafts (≤ 10 min), rate-limit timestamps | see below |
| nowhere | message text, sender names, drafts, conversation refs, tokens in clear | privacy invariant |

**Why memory and not SQLite for nonces/idempotency/rate limits:** the idempotency cache must hold
the draft text, and drafts may never touch disk. Nonces and counters only need to outlive their
windows. The service is single-instance by design, so a restart that forgets them is acceptable
(stale timestamps are still rejected by the ±5 min window). Every store is bounded
(`BRIDGE_MEMORY_MAX_ENTRIES`); the nonce store fails closed (429) rather than evicting live nonces.
Running more than one instance would need a shared store — deliberately out of scope.

**Retention:** `last_seen_at` is stored with day granularity (UTC date only; at most one write per
device per day), so the DB holds no timeline of when messages arrived. Devices revoked more than
30 days ago are deleted automatically at every start and by `admin purge` (also drops pairing
codes dead for > 24 h). Schema migration v2 coarsens existing `last_seen_at` values (versioned,
idempotent).

Tests prove this: `tests/test_api_privacy.py` pushes a unique marker through every code path and
asserts it never appears in any log record or in the bytes of the SQLite files (incl. `-wal`/`-shm`).

## Logging

One JSON line per request with `method`, `path`, `status`, `latency_ms`, `device` (first 8 chars of
the device id) and `request_id`. The formatter serialises only an allow-list of attributes, and a
redaction filter strips any record attribute named `text`, `messages`, `draft_text`,
`sender_display_name`, `authorization`, `device_token` (and more). Exceptions are logged as their
class name only — never their message or traceback, which could echo content. Uvicorn's access log
is off by default (`BRIDGE_ACCESS_LOG`); it would only log method/path/status anyway.

## Disable / rollback

- **Disable:** set `BRIDGE_ENABLED=false` and restart, or create the `BRIDGE_KILL_SWITCH_FILE`
  (takes effect on the next request). `/health` keeps answering with `"enabled": false`.
- **Revoke one phone:** `python -m bridge_service.admin revoke-device <id>` (or "ניתוק מלא" in the app).
- **Rollback:** stop the service. Nothing else depends on it; the app just shows that drafting is
  unavailable. To erase all server state delete the `BRIDGE_DB_PATH` file(s) — memory state dies
  with the process.

## Layout

```
bridge_service/
  main.py            create_app(settings, engine) factory, `app` for uvicorn, lifespan closes engine
  config.py          Settings (pydantic-settings, BRIDGE_ prefix)
  admin.py           operator CLI
  logging_setup.py   JSON formatter + redaction filter
  api/               routes, request models, error envelope, ASGI middleware, per-app state
  security/          tokens, pairing codes, replay guard, rate limiter, auth dependencies
  storage/           sqlite (migrations, repositories), bounded in-memory TTL store
  ai/                AI team: engines behind the DraftEngine protocol
```
